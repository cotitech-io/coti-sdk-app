const {
  cryptoUtils,
  transactionUtils,
  EcKeyPair,
  nodeUtils,
  NodeClient,
  WebSocket,
  ReducedTransaction,
  Wallet,
  utils,
} = require('@coti-io/crypto');

// chose coti network , mainnet or testnet
const network = 'mainnet';
const fullNodeUrl = 'full node url';
const trustScoreNodeUrl = 'trust score url'

// api key that Coti provides, only to be used one time for each seed to insert the public key to the trust score node
const apiKey = 'yourApiKey';

(async () => {
  try {
    // generate bip39 mnemonic to be stored for recovery of seed
    const mnemonic = cryptoUtils.generateMnemonic();
    console.log(`Mnemonic: ${mnemonic}`);

    // generate seed in 64 bytes from mnemonic
    const seedIn64Bytes = await cryptoUtils.generateSeedFromMnemonic(mnemonic);
    console.log(`seedIn64Bytes: ${seedIn64Bytes}`);

    // generate seed in 32bytes
    const seed = cryptoUtils.generateSeed(seedIn64Bytes);
    console.log(`seedIn32Bytes: ${seed}`)

    // ec to be used to sign all messages
    const userKeyPair = new EcKeyPair(seed);
    // user public key
    const userHash = userKeyPair.getPublicKey();
    console.log(`User public key: ${userHash}`);

    const addressIndex = 0;
    // // ec to be used to sign for transactions sent from address of index addressIndex.
    const addressKeyPair = new EcKeyPair(seed, addressIndex);
    // // address in hexadecimal of index addressIndex
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
    const baseWallet = new Wallet({ seed, fullnode: fullNodeUrl, network, trustScoreNode: trustScoreNodeUrl });
    // listen for balance changes
    baseWallet.onBalanceChange((balanceChangedAddress) => console.log('Balance change: ', balanceChangedAddress));
    //listen for new transaction or transaction status changes
    baseWallet.onReceivedTransaction((receivedTransaction) => console.log('Received transaction', receivedTransaction));
    //listen for new generated address
    baseWallet.onGenerateAddress((addressHex) => console.log('Generated address', addressHex));

    /* initiate BaseAddress instance to load to BaseWallet instance.
       By default, the preBalance and balance are initiated by 0. If
       you store the address with its balances at your DB (which is
       strongly recommended), then you can set those balances with:
          baseAddress.setBalance(balance);
          baseAddress.setPreBalance(preBalance);
       where balance and preBalance are the values from DB. Then at
       checkBalancesOfAddresses method call, onBalanceChange will be
       triggered only for addresses whose balances are changed. Otherwise,
       every time checkBalancesOfAddresses method is called, you will
       get all the address balances at onBalanceChange.
    */
    // const baseAddress = new BaseAddress(address);
    const address = await baseWallet.generateAddressByIndex(addressIndex);
    // loading the addresses to baseWallet
    await baseWallet.loadAddresses([address]);

    // Initiate here a transaction from DB that is related with address. This transaction is stored to DB by your app previously.
    let transactionFromDb;
    // createTime and transactionConsensusUpdateTime are timestamp in seconds with milliseconds in decimal points
    const { hash, createTime, transactionConsensusUpdateTime } = transactionFromDb;
    // transaction to load to baseWallet
    const reducedTransaction = new ReducedTransaction(hash, createTime, transactionConsensusUpdateTime);
    // load the initial known transactions related with your loaded addresses
    await baseWallet.loadTransactions([reducedTransaction]);

    // sync the balances of native coti for all loaded addresses from network
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

    // when you generate another address, and you want to monitor it, you should do:
    const newAddressIndex = 1;
    // new address
    const newAddress = await baseWallet.generateAddressByIndex(newAddressIndex)
    // load the new baseAddress to baseWallet
    await baseWallet.setAddress(newAddress);
    // websocket subscription to the new address. Pay attention that newAddress is hexadecimal string
    webSocket.connectToAddress(newAddress.getAddressHex());
    // END OF BASEWALLET and WEBSOCKET use

    // create input map to spend Coti from address
    const amountSpend = 1;
    const inputMap = new Map();
    inputMap.set(address.getAddressHex(), amountSpend);

    // here insert a destination address in hex
    const destinationAddress = 'destinationAddressInHex';

    //checks if fullnode had multi currency hardfork
    const hardFork = await nodeUtils.isNodeSupportMultiCurrencyApis('mainnet', baseWallet.getFullNode());

    const transactionProperties = {
      userPrivateKey: userKeyPair.getPrivateKey(),
      inputMap,
      feeAddress: address.getAddressHex(), // fee address can be different from addresses in the input map. Then put the private key of feeAddress at the end of private keys to be used to sign
      destinationAddress,
      wallet: baseWallet,
      network,
    };

    if(hardFork === transactionUtils.HardForks.MULTI_CURRENCY){
      // get the balances of none native tokens for given addresses array.
      await nodeUtils.getTokenBalances([address.getAddressHex()]);
      // get balances of all wallet addresses from network none native token balances
      await nodeUtils.getUserTokenCurrencies(userHash, baseWallet, baseWallet.getFullNode());
      //multi currency additional properties
      //we will use as an example transfer of native currency
      const cotiCurrencyHash = utils.getCurrencyHashBySymbol('coti');
      console.log(`coti currencyHash: ${cotiCurrencyHash}`);
      //token hash that we want to transfer
      transactionProperties.currencyHash = cotiCurrencyHash;
      transactionProperties.hardFork = hardFork;
      //currency to pay fees with
      transactionProperties.originalCurrencyHash = cotiCurrencyHash;
    }

    // create locally the transaction
    // changes in fullnode that had hard fork of multi currency
    // 1) IBT changes:
    //    1.1) IBT will have new property named 'currencyHash' which describe the token that being transferred.
    //    1.2) there must be at least one IBT with native currencyHash to pay the fees.
    const transaction = await transactionUtils.createTransaction(transactionProperties);

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
    // changes in fullnode that had hard fork of multi currency
    // 1) RBT new properties:
    //    1.1) named 'currencyHash' which says what token received(in case its native the currencyHash value will be 'ae2b227ab7e614b8734be1f03d1532e66bf6caf76accc02ca4da6e28').
    //    1.2) named 'originalCurrencyHash' string currencyHash which says what token used to pay fees.(currently fullnode accepts only native)
    const transactionFromNode = await nodeClient.getTransaction(transactionHash);
    console.log(`Transaction from node:`);
    console.log(transactionFromNode);

    // get transaction history by address array
    const transactionHistory = await nodeClient.getTransactionsHistory([address.getAddressHex()]);
    console.log(`Transaction history:`);
    console.log(transactionHistory);

    // check balances of address array
    const addressBalances = await nodeClient.checkBalances([address.getAddressHex()]);
    console.log(`Address balances:`);
    console.log(addressBalances);
  } catch (e) {
    console.log(e);
  }
})();
