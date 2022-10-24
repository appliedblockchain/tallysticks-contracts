import algosdk, { LogicSigAccount, Account } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { algodClient, indexerClient } from '../utils/init'
import { compile } from '../utils/compile'
import { transferAlgos } from '../utils/transfer-algos'
import { getAppTokenIds } from '../utils/matching-helpers'
import { createTransferAssetTxn, waitForTransaction } from '../utils/transactions'
import { createOptInAssetTxn } from '../utils/opt-in'
import { getGlobalStateValue, getLocalStateValue } from '../utils/state'

export async function getEscrow(investorAddress: string, appId: number): Promise<LogicSigAccount> {
  const tokens = await getAppTokenIds(appId)
  const useProcessEnv = true
  const matchingConfig = {
    INVESTOR_ADDRESS: investorAddress,
    MATCHING_APP_ID: appId,
    CURRENCY_TOKEN_ID: tokens.currencyId,
    BIDDING_TOKEN_ID: tokens.bidId,
    ACCESS_TOKEN_ID: tokens.accessId,
    MINIMUM_INTEREST: getConfigNumber('MINIMUM_LOAN_INTEREST', useProcessEnv),
    MAXIMUM_RISK: getConfigNumber('MAXIMUM_LOAN_RISK'),
    MINIMUM_VALUE: getConfigNumber('MINIMUM_LOAN_VALUE'),
    MAXIMUM_VALUE: getConfigNumber('MAXIMUM_LOAN_VALUE'),
    MINIMUM_TERM: getConfigNumber('MINIMUM_LOAN_TERM', useProcessEnv),
    MAXIMUM_TERM: getConfigNumber('MAXIMUM_LOAN_TERM', useProcessEnv),
  }
  const compiled = await compile('investor-escrow.teal', '', matchingConfig)
  const program = new Uint8Array(Buffer.from(compiled.result, 'base64'))
  const args = []
  return new algosdk.LogicSigAccount(program, args)
}

export async function getInvestorAddressFromEscrowAddress(escrowAddress: string, appId: number): Promise<string> {
  const investorAddress = (await getLocalStateValue({
    address: escrowAddress,
    appId,
    key: 'investor_address',
    decodeValue: false,
  })) as Buffer
  return await algosdk.encodeAddress(investorAddress)
}

export async function getEscrowFromEscrowAddress(escrowAddress: string, appId: number): Promise<LogicSigAccount> {
  const investorAddress = await getInvestorAddressFromEscrowAddress(escrowAddress, appId)
  return await getEscrow(investorAddress, appId)
}

export async function getOpenEscrows(appId: number): Promise<LogicSigAccount[]> {
  const tokens = await getAppTokenIds(appId)
  const accounts = await indexerClient
    .lookupAssetBalances(tokens.accessId)
    .currencyGreaterThan(0)
    .currencyLessThan(2)
    .do()
  const escrows: LogicSigAccount[] = []
  for (const account of accounts.balances) {
    if (account.amount === 1) {
      escrows.push(await getEscrowFromEscrowAddress(account.address, appId))
    }
  }
  return escrows
}

export async function initialiseEscrow(escrow: LogicSigAccount, appId: number, creator: Account): Promise<void> {
  // Send minimum balance of algos
  const INVESTOR_ESCROW_INITIAL_BALANCE = getConfigNumber('INVESTOR_ESCROW_INITIAL_BALANCE')
  const MINIMUM_TRANSACTION_FEE = getConfigNumber('MINIMUM_TRANSACTION_FEE')
  // Escrow will initially pay for 4 transactions: opt in to bidding token, access token, currency and matching app
  const requiredBalance = INVESTOR_ESCROW_INITIAL_BALANCE + 4 * MINIMUM_TRANSACTION_FEE
  await transferAlgos(creator, escrow.address(), requiredBalance)

  const tokens = await getAppTokenIds(appId)
  // Opt in to currency token
  const currencyAssetTxn = await createOptInAssetTxn(escrow.address(), tokens.currencyId)
  // Opt in to application
  const params = await algodClient.getTransactionParams().do()
  const appTxn = await algosdk.makeApplicationOptInTxn(escrow.address(), params, appId)
  // Group all opt-in transactions together (required)
  algosdk.assignGroupID([currencyAssetTxn, appTxn])
  const signedCurrencyAssetTxn = algosdk.signLogicSigTransaction(currencyAssetTxn, escrow)
  const signedAppTxn = algosdk.signLogicSigTransaction(appTxn, escrow)
  const tx = await algodClient.sendRawTransaction([signedCurrencyAssetTxn.blob, signedAppTxn.blob]).do()
  await waitForTransaction(tx.txId)
}

export async function getAndOptInEscrow(investor: Account, appId: number): Promise<LogicSigAccount> {
  const escrow = await getEscrow(investor.addr, appId)
  await initialiseEscrow(escrow, appId, investor)
  return escrow
}

export async function bid(investorAddress: string, appId: number, invoice: LogicSigAccount): Promise<void> {
  const escrow = await getEscrow(investorAddress, appId)
  const tokens = await getAppTokenIds(appId)
  const params = await algodClient.getTransactionParams().do()

  // Transfer bidding token from escrow to matching app
  const appAddress = algosdk.getApplicationAddress(appId)
  const bidAssetTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: appAddress,
    assetId: tokens.bidId,
    amount: 1,
    params,
  })

  // Escrow calls the bid function in matching application
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const useProcessEnv = true
  const bidTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: escrow.address(),
    suggestedParams: params,
    appIndex: appId,
    appArgs: [
      new Uint8Array(Buffer.from('bid')),
      algosdk.encodeUint64(getConfigNumber('MINIMUM_LOAN_VALUE')),
      algosdk.encodeUint64(getConfigNumber('MAXIMUM_LOAN_VALUE')),
      algosdk.encodeUint64(getConfigNumber('MINIMUM_LOAN_TERM', useProcessEnv)),
      algosdk.encodeUint64(getConfigNumber('MAXIMUM_LOAN_TERM', useProcessEnv)),
      algosdk.encodeUint64(getConfigNumber('MINIMUM_LOAN_INTEREST', useProcessEnv)),
      algosdk.encodeUint64(getConfigNumber('MAXIMUM_LOAN_RISK')),
    ],
    foreignAssets: [tokens.bidId, tokens.currencyId],
    foreignApps: [minterId],
    accounts: [invoice.address()],
  })

  algosdk.assignGroupID([bidAssetTxn, bidTxn])
  const signedBidAssetTxn = algosdk.signLogicSigTransaction(bidAssetTxn, escrow)
  const signedBidTxn = algosdk.signLogicSigTransaction(bidTxn, escrow)
  const tx = await algodClient.sendRawTransaction([signedBidAssetTxn.blob, signedBidTxn.blob]).do()

  await waitForTransaction(tx.txId)
}

export async function reclaim(investorAddress: string, appId: number): Promise<void> {
  const escrow = await getEscrow(investorAddress, appId)
  const tokens = await getAppTokenIds(appId)
  const params = await algodClient.getTransactionParams().do()

  params.flatFee = true
  params.fee = getConfigNumber('RECLAIM_FEE') // Pay for all transactions in this group
  // Check if balance above minimum, add extra transaction fee if it isn't
  const info = await algodClient.accountInformation(escrow.address()).do()
  const minAlgos = getConfigNumber('RECLAIM_FEE') + getConfigNumber('MAX_BIDDING_FEES')
  if (info.amount - info['min-balance'] < minAlgos) {
    params.fee = getConfigNumber('RECLAIM_FEE') + getConfigNumber('MINIMUM_TRANSACTION_FEE')
  }

  const reclaimTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: escrow.address(),
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('reclaim'))],
    foreignAssets: [tokens.bidId, tokens.accessId],
  })

  const signedReclaimTxn = algosdk.signLogicSigTransaction(reclaimTxn, escrow)
  const tx = await algodClient.sendRawTransaction([signedReclaimTxn.blob]).do()

  await waitForTransaction(tx.txId)
}
