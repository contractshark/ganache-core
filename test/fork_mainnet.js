var Web3 = require("web3");
var assert = require("assert");
var Ganache = require(process.env.TEST_BUILD
  ? "../build/ganache.core." + process.env.TEST_BUILD + ".js"
  : "../index.js");

describe("Forking mainnet", function() {
  this.timeout(60000);

  it("does not revert re-entered on cDAI", async() => {
    const web3 = new Web3(
      Ganache.provider({
        allowUnlimitedContractSize: true,
        fork: "https://mainnet.infura.io/v3/9d4e156910574938989589b1e328c94a"
      })
    );

    const cDAI = new web3.eth.Contract(
      [
        {
          name: "borrowBalanceCurrent",
          constant: false,
          inputs: [{ internalType: "address", name: "account", type: "address" }],
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          payable: false,
          stateMutability: "nonpayable",
          type: "function",
          signature: "0x17bfdfbc"
        },

        {
          name: "totalBorrowsCurrent",
          constant: false,
          inputs: [],
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          payable: false,
          stateMutability: "nonpayable",
          type: "function",
          signature: "0x73acee98"
        }
      ],
      "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643"
    );

    assert.ok(await cDAI.methods.borrowBalanceCurrent("0x586e32930ac05127de429bd566eaa2758fcbd9bc").call());
    assert.ok(await cDAI.methods.totalBorrowsCurrent().call());
  });
});
