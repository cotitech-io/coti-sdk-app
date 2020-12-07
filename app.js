const { cryptoUtils, transactionUtils, EcKeyPair, nodeUtils, NodeClient } = require('@coti-io/crypto');

// chose coti network , mainnet or testnet
const network = 'testnet';

// api key that Coti provides, only to be used one time for each seed to insert the public key to the trust score node
const apiKey = 'yourApiKey';

(async () => {
  try {
    // generate bip39 mnemonic to be stored for recovery of seed
    const mnemonic = cryptoUtils.generateMnemonic();
    console.log(`Mnemonic: ${mnemonic}`);

    // generate seed from mnemonic
    const seed = await cryptoUtils.generateSeedFromMnemonic(mnemonic);
    console.log(`Seed: ${seed}`);

    // ec to be used to sign all messages
    const userKeyPair = new EcKeyPair(seed);
    // user public key
    const userHash = userKeyPair.getPublicKey();
    console.log(`User public key: ${userHash}`);

    const addressIndex = 0;
    // ec to be used to sign for transactions sent from address of index addressIndex.
    const addressKeyPair = new EcKeyPair(seed, addressIndex);
    // address in hexadecimal of index addressIndex
    const address = addressKeyPair.toAddress();
    const addressPrivateKey = addressKeyPair.getPrivateKey();

    try {
      /* check if trust score node has the user public key. Without having trust score, you can receive Coti from other addresses.
         But when you need to spend your coti from your address, trustscore should be previously set for address owner
      */
      const trustScoreResponse = await nodeUtils.getUserTrustScore(userHash, network);
      console.log(`Trust score taken from TS node:`);
      console.log(trustScoreResponse);
    } catch (e) {
      if (e.message === 'User does not exist!') {
        // seeting trust score. Only one time action.
        const trustScoreResponse = await nodeUtils.setTrustScore(apiKey, userHash, network);
        console.log(`Trust score inserted:`);
        console.log(trustScoreResponse);
      }
    }

    // create input map to spend Coti from address
    const amountSpend = 1;
    const inputMap = new Map();
    inputMap.set(address, amountSpend);

    // here insert a destination address in hex
    const destinationAddress = 'destinationAddressInHex';

    // create locally the transaction
    const transaction = await transactionUtils.createTransaction({
      userPrivateKey: userKeyPair.getPrivateKey(),
      inputMap,
      feeAddress: address, // fee address can be different from addresses in the input map. Then put the private key of feeAddress at the end of private keys to be used to sign
      destinationAddress,
      network,
    });

    // sign locally the transaction
    transaction.signWithPrivateKeys(
      userKeyPair.getPrivateKey(), // to sign the transaction. It is not used to spend from addresses.
      [addressPrivateKey] // if fee address is not in input map , address private keys array looks like [addressPrivateKey, feeAddressPrivateKey]
    );

    // node client for actions with Coti network
    const nodeClient = new NodeClient(network);

    // sending transaction to Coti network
    const sendTransaction = await nodeClient.sendTransaction(transaction);

    const transactionHash = transaction.getHash();

    // to monitor the transaction status, use the following method. Statuses are pending and confirmed
    const transactionFromNode = await nodeClient.getTransaction(transactionHash);
    console.log(`Transaction from node:`);
    console.log(transactionFromNode);

    // get transaction history by address array
    const transactionHistory = await nodeClient.getTransactionsHistory([address]);
    console.log(`Transaction history:`);
    console.log(transactionHistory);

    // check balances of address array
    const addressBalances = await nodeClient.checkBalances([address]);
    console.log(`Address balances:`);
    console.log(addressBalances);
  } catch (e) {
    console.log(e);
  }
})();
