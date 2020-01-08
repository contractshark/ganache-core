import Miner from "./miner";
import Database from "./database";
import Emittery from "emittery";
import BlockManager, { Block } from "./components/block-manager";
import TransactionManager from "./components/transaction-manager";
import Trie from "merkle-patricia-tree";
import { BN } from "ethereumjs-util";
import Account from "../../types/account";
import { promisify } from "util";
import { Quantity, Data } from "../../types/json-rpc";
import EthereumJsAccount from "ethereumjs-account";
import AccountManager from "./components/account-manager";
import Heap from "../../utils/heap";
import Transaction from "../../types/transaction";

const VM = require("ethereumjs-vm");

export enum Status {
  // Flags
  started = 1,
  starting = 3,
  stopped = 4,
  stopping = 12
}

type BlockchainOptions = {
  db?: string | object,
  db_path?: string,
  accounts?: Account[],
  hardfork?: string,
  allowUnlimitedContractSize?: boolean,
  gasLimit?: Quantity,
  timestamp?: Date
};

export default class Blockchain extends Emittery {
  private state: Status = Status.starting;
  public blocks: BlockManager;
  public transactions: TransactionManager;
  public accounts: AccountManager;
  public vm: any;
  public trie: Trie;
  private readonly database: Database

  /**
   * Initializes the underlying Database and handles synchronization between
   * the ledger and the database.
   * 
   * Emits a `ready` event once the database and
   * all dependencies are fully initialized.
   * @param options 
   */
  constructor(options: BlockchainOptions) {
    super();

    const database = this.database = new Database(options, this);

    database.on("ready", async () => {
      // TODO: get the latest block from the database
      // if we have a latest block, `root` will be that block's header.stateRoot
      // and we will skip creating the genesis block alltogether
      const root: Buffer = null;
      this.trie = new Trie(database.trie, root);
      this.blocks = new BlockManager(this, database.blocks);
      this.vm = this.createVmFromStateTrie(this.trie, options.hardfork, options.allowUnlimitedContractSize);

      const miner = new Miner(this.vm, options);
      this.transactions = new TransactionManager(this, database.transactions, options);
      this.accounts = new AccountManager(this);

      await this._initializeAccounts(options.accounts);
      let lastBlock = this._initializeGenesisBlock(options.timestamp, options.gasLimit);

      const readyNextBlock = async () => {
        const previousBlock = await lastBlock;
        const previousHeader = previousBlock.value.header;
        const previousNumber = Quantity.from(previousHeader.number).toBigInt() || 0n;
        return this.blocks.createBlock({
          number: Quantity.from(previousNumber + 1n).toBuffer(),
          gasLimit: options.gasLimit.toBuffer(),
          timestamp: this._currentTime(),
          parentHash: previousHeader.hash(),
        });
      }
      const instamining = true;
      if (instamining) {
        this.transactions.transactionPool.on("drain", async (pending: Map<string, Heap<Transaction>>) => {
          const block = await readyNextBlock();
          await miner.mine(pending, block.value);
        });
      } else {
        // TODO: the interval needs to be from the `options`
        const minerInterval = 3 * 1000;
        const mine = async (pending: Map<string, Heap<Transaction>>) => {
          const block = await readyNextBlock();
          await miner.mine(pending, block.value);
          setTimeout(mine, minerInterval, pending);
        };
        setTimeout(mine, minerInterval, this.transactions.transactionPool.executables);
      }

      
      miner.on("block", async (blockData: any) => {
        const previousBlock = await lastBlock;
        const previousHeader = previousBlock.value.header;
        const previousNumber = Quantity.from(previousHeader.number).toBigInt() || 0n;
        const block = this.blocks.createBlock({
          parentHash: previousHeader.hash(),
          number: Quantity.from(previousNumber + 1n).toBuffer(),
          // coinbase: 
          timestamp: this._currentTime(),
          // difficulty: 
          gasLimit: options.gasLimit.toBuffer(),
          transactionsTrie: blockData.transactionsTrie.root,
          receiptTrie: blockData.receiptTrie.root,
          stateRoot: this.trie.root
        });
        // TODO: save the transactions, et al, too
        // blockData.blockTransactions

        this.blocks.latest = block;
        lastBlock = this.blocks.set(block);
      });

      this.blocks.earliest = this.blocks.latest = await lastBlock;
      this.state = Status.started;
      this.emit("start");
    });
  }

  private createVmFromStateTrie(stateTrie: Trie, hardfork: string, allowUnlimitedContractSize: boolean): any {
    const vm = new VM({
      state: stateTrie,
      activatePrecompiles: true,
      hardfork,
      allowUnlimitedContractSize,
      blockchain: {
        getBlock: async (number: BN, done: any) => {
          const hash = await this._blockNumberToHash(number);
          done(this.blocks.get(hash));
        }
      }
    });
    vm.on("step", this.emit.bind(this, "step"));
    return vm;
  }

  private async _initializeAccounts(accounts: Account[]): Promise<void> {
    const stateManager = this.vm.stateManager;
    const putAccount = promisify(stateManager.putAccount.bind(stateManager));
    const checkpoint = promisify(stateManager.checkpoint.bind(stateManager))
    const commit = promisify(stateManager.commit.bind(stateManager))
    await checkpoint();
    const l = accounts.length;
    const pendingAccounts = Array(l);
    for (let i = 0; i < l; i++) {
      const account = accounts[i];
      const ethereumJsAccount = new EthereumJsAccount();
      ethereumJsAccount.nonce = account.nonce.toBuffer(),
      ethereumJsAccount.balance = account.balance.toBuffer()
      pendingAccounts[i] = putAccount(account.address.toBuffer(), ethereumJsAccount);
    }
    await Promise.all(pendingAccounts);
    return commit();
  }

  private async _initializeGenesisBlock(timestamp: Date, blockGasLimit: Quantity): Promise<Block> {
    // create the genesis block
    const genesis = this.blocks.next({
      // If we were given a timestamp, use it instead of the `_currentTime`
      timestamp: ((timestamp as any) / 1000 | 0) || this._currentTime(),
      gasLimit: blockGasLimit.toBuffer(),
      stateRoot: this.trie.root,
      number: "0x0"
    });

    // store the genesis block in the database
    return this.blocks.set(genesis);
  }

  private _currentTime() {
    // Take the floor of the current time
    return (Date.now() / 1000) | 0;
  }

  /**
   * Given a block number, find its hash in the database
   * @param number 
   */
  private _blockNumberToHash(number: BN): Promise<Buffer> {
    return number.toString() as any;
  }

  public async queueTransaction(transaction: any): Promise<Data> {
    await this.transactions.push(transaction);
    return Data.from(transaction.hash());
  }

  public async simulateTransaction(transaction: any, parentBlock: Block, block: Block): Promise<Data> {
    // TODO: this is just a prototype implementation
    const vm = this.vm.copy();
    const stateManager = vm.stateManager;
    await promisify(stateManager.setStateRoot.bind(stateManager))(parentBlock.value.header.stateRoot);
    transaction.block = block;
    transaction.caller = transaction.from;
    const result = await promisify(vm.runCall.bind(vm))(transaction);
    return result.vm.returnValue || "0x";
  }

  /**
   * Gracefully shuts down the blockchain service and all of its dependencies.
   */
  public async stop() {
    // If the blockchain is still initalizing we don't want to shut down
    // yet because there may still be database calls in flight. Leveldb may
    // cause a segfault due to a race condition between a db write and the close
    // call.
    if (this.state === Status.starting) {
      await new Promise((resolve) => {
        this.on("start", resolve);
      });
    }
    if (this.state === Status.started) {
      this.state = Status.stopping;
      await this.database.close();
      this.state = Status.stopped;
    }
    this.emit("stop");
  }
}