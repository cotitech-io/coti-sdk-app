const {
  cryptoUtils,
  transactionUtils,
  EcKeyPair,
  nodeUtils,
  NodeClient,
  BaseAddress,
  BaseWallet,
  WebSocket,
  ReducedTransaction,
} = require('@coti-io/crypto');

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

    // BASEWALLET and WEBSOCKET use
    const baseWallet = new BaseWallet(network);
    // listen for balance changes
    baseWallet.onBalanceChange((balanceChangedAddress) => console.log('Balance change: ', balanceChangedAddress));
    //listen for new transaction or transaction status changes
    baseWallet.onReceivedTransaction((receivedTransaction) => console.log('Received transaction', receivedTransaction));

    /* initiate BaseAddress instance to load to BaseWallet instance.
       By default the preBalance and balance are initiated by 0. If
       you store the address with its balances at your DB (which is
       strongly recommended), then you can set those balances with:
          baseAddress.setBalance(balance);
          baseAddress.setPreBalance(preBalance);
       where balance and preBalance are the values from DB. Then at
       checkBalancesOfAddresses method call, onBalanceChange will be
       triggered only for addresses whose balances are changed. Otherwise
       every time checkBalancesOfAddresses method is called, you will
       get all the address balances at onBalanceChange.
    */
    const baseAddress = new BaseAddress(address);
    // loading the addresses to baseWallet
    baseWallet.loadAddresses([baseAddress]);

    // Initiate here a transaction from DB that is related with address. This transaction is stored to DB by your app previously.
    let transactionFromDb;
    // createTime and transactionConsensusUpdateTime are timestamp in seconds with milliseconds in decimal points
    const { hash, createTime, transactionConsensusUpdateTime } = transactionFromDb;
    // transaction to load to baseWallet
    const reducedTransaction = new ReducedTransaction(hash, createTime, transactionConsensusUpdateTime);
    // load the initially know transactions related with your loaded addresses
    baseWallet.loadTransactions([reducedTransaction]);

    // sync the balances of all loaded addresses from network
    await baseWallet.checkBalancesOfAddresses();
    // sync all loaded transactions related with loaded addresses from network
    await baseWallet.checkTransactionHistory();

    // initiate your websocket instance
    const webSocket = new WebSocket(baseWallet);
    // success callback for WebSocket connection
    const successCallback = async () => console.log('Connection success');
    // reconnect fail callback for WebSocket connection
    const reconnectFailedCallback = async () => console.log('Error to websocket connection');
    // websocket connection
    await webSocket.connect(successCallback, reconnectFailedCallback);

    // when you generate another address and you want to monitor it, you should do:
    const newAddressIndex = 1;
    const newAddressKeyPair = new EcKeyPair(seed, newAddressIndex);
    // new address in hex
    const newAddress = newAddressKeyPair.toAddress();
    const newBaseAddress = new BaseAddress(newAddress);
    // load the new baseAddress to baseWallet
    await baseWallet.setAddress(newBaseAddress);
    // websocket subscription to the new address. Pay attention that newAddress is hexadecimal string
    webSocket.connectToAddress(newAddress);
    // END OF BASEWALLET and WEBSOCKET use

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
