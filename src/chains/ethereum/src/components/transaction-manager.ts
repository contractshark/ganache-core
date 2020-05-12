import Transaction from "../things/transaction";
import Manager from "./manager";
import TransactionPool, {TransactionPoolOptions} from "./transaction-pool";
import levelup from "levelup";
import Blockchain from "../blockchain";
import Heap from "@ganache/utils/src/utils/heap";

export type TransactionManagerOptions = TransactionPoolOptions;

export default class TransactionManager extends Manager<Transaction> {
  public transactionPool: TransactionPool;

  constructor(blockchain: Blockchain, base: levelup.LevelUp, options: TransactionManagerOptions) {
    super(blockchain, base, Transaction);

    this.transactionPool = new TransactionPool(blockchain, options);
    this.transactionPool.on("drain", (transactions: Map<string, Heap<Transaction>>) => {
      // TODO: create pending block?
    });
  }

  public push(transaction: Transaction): Promise<void> {
    return this.transactionPool.insert(transaction);
  }
}