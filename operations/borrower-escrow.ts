import algosdk, { LogicSigAccount, Account } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { algodClient } from '../utils/init'
import { compile } from '../utils/compile'
import { transferAlgos } from '../utils/transfer-algos'
import { getAppTokenIds } from '../utils/matching-helpers'
import { createTransferAssetTxn, transferAsset, waitForTransaction } from '../utils/transactions'
import { createOptInAssetTxn } from '../utils/opt-in'
import { getGlobalStateValue, getLocalStateValue } from '../utils/state'
import { optInvoiceIntoMatchingApplication } from '../utils/mint'

export async function getBorrowerEscrow(borrowerAddress: string, appId: number): Promise<LogicSigAccount> {
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const tokens = await getAppTokenIds(appId)
  const escrowConfig = {
    BORROWER_ADDRESS: borrowerAddress,
    MATCHING_APP_ID: appId,
    MINTING_APP_ID: minterId,
    CURRENCY_TOKEN_ID: tokens.currencyId,
  }
  const compiled = await compile('borrower-escrow.teal', '', escrowConfig)
  const program = new Uint8Array(Buffer.from(compiled.result, 'base64'))
  const args = []
  return new algosdk.LogicSigAccount(program, args)
}

export async function initialiseBorrowerEscrow(
  escrow: LogicSigAccount,
  appId: number,
  borrower: Account,
): Promise<void> {
  // Send minimum balance of algos
  const BORROWER_ESCROW_MINIMUM_BALANCE = getConfigNumber('BORROWER_ESCROW_MINIMUM_BALANCE')
  const MINIMUM_TRANSACTION_FEE = getConfigNumber('MINIMUM_TRANSACTION_FEE')
  // Escrow will initially pay for 4 transactions: opt in to bidding token, access token, currency and matching app
  const requiredBalance = BORROWER_ESCROW_MINIMUM_BALANCE + 4 * MINIMUM_TRANSACTION_FEE
  await transferAlgos(borrower, escrow.address(), requiredBalance)

  // Opt in to currency token
  const tokens = await getAppTokenIds(appId)
  const currencyAssetTxn = await createOptInAssetTxn(escrow.address(), tokens.currencyId)
  const signedCurrencyAssetTxn = algosdk.signLogicSigTransaction(currencyAssetTxn, escrow)
  const tx1 = await algodClient.sendRawTransaction(signedCurrencyAssetTxn.blob).do()
  await waitForTransaction(tx1.txId)

  // Opt in to matching application
  const params = await algodClient.getTransactionParams().do()
  const matchAppTxn = await algosdk.makeApplicationOptInTxn(escrow.address(), params, appId)
  const signedMatchAppTxn = algosdk.signLogicSigTransaction(matchAppTxn, escrow)
  const tx2 = await algodClient.sendRawTransaction(signedMatchAppTxn.blob).do()
  await waitForTransaction(tx2.txId)

  // Opt in to minting application
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const mintAppTxn = await algosdk.makeApplicationOptInTxn(escrow.address(), params, minterId)
  const signedMintAppTxn = algosdk.signLogicSigTransaction(mintAppTxn, escrow)
  const tx3 = await algodClient.sendRawTransaction(signedMintAppTxn.blob).do()
  await waitForTransaction(tx3.txId)
}

export async function getAndOptInBorrowerEscrow(borrower: Account, appId: number): Promise<LogicSigAccount> {
  const escrow = await getBorrowerEscrow(borrower.addr, appId)
  await initialiseBorrowerEscrow(escrow, appId, borrower)
  return escrow
}

export async function sendFunds(borrower: Account, appId: number, amount: number): Promise<void> {
  const escrow = await getBorrowerEscrow(borrower.addr, appId)
  const tokens = await getAppTokenIds(appId)
  await transferAsset(borrower, escrow.address(), tokens.currencyId, amount)
}

export async function withdrawFunds(borrowerAddress: string, appId: number, amount: number): Promise<void> {
  const escrow = await getBorrowerEscrow(borrowerAddress, appId)
  const params = await algodClient.getTransactionParams().do()
  const tokens = await getAppTokenIds(appId)
  const transferTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: borrowerAddress,
    assetId: tokens.currencyId,
    amount,
    params,
  })
  const signedTransferTxn = algosdk.signLogicSigTransaction(transferTxn, escrow)
  const tx = await algodClient.sendRawTransaction(signedTransferTxn.blob).do()
  await waitForTransaction(tx.txId)
}

export async function verify(borrowerAddress: string, appId: number, invoice: LogicSigAccount): Promise<void> {
  const escrow = await getBorrowerEscrow(borrowerAddress, appId)
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  // Invoice opts in to matching app
  const params = await algodClient.getTransactionParams().do()
  try {
    await optInvoiceIntoMatchingApplication(escrow, minterId, appId, invoice)
  } catch (e) {
    console.warn('Invoice already opted in')
  }

  // Borrower calls verify function in matching app
  params.flatFee = true
  params.fee = getConfigNumber('VERIFY_FEE')
  const ownerTokenId = (await getLocalStateValue({
    address: invoice.address(),
    appId: minterId,
    key: 'asa_id',
  })) as number
  const verifyTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: escrow.address(),
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('verify'))],
    foreignAssets: [ownerTokenId],
    foreignApps: [minterId],
    accounts: [invoice.address()],
  })

  // Transfer ownership token to app
  const tfrParams = await algodClient.getTransactionParams().do()
  const appAddress = await algosdk.getApplicationAddress(appId)
  const ownAssetTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: appAddress,
    assetId: ownerTokenId,
    amount: 1,
    params: tfrParams,
  })

  algosdk.assignGroupID([verifyTxn, ownAssetTxn])
  const signedVerifyTxn = algosdk.signLogicSigTransaction(verifyTxn, escrow)
  const signedOwnAssetTxn = algosdk.signLogicSigTransaction(ownAssetTxn, escrow)
  const tx = await algodClient.sendRawTransaction([signedVerifyTxn.blob, signedOwnAssetTxn.blob]).do()
  await waitForTransaction(tx.txId)
}

export interface RepayParams {
  borrowerAddress: string
  appId: number
  invoice: LogicSigAccount
  investorEscrow: LogicSigAccount
  amount?: number
}

export async function repay({ borrowerAddress, appId, invoice, investorEscrow, amount }: RepayParams): Promise<string> {
  const borrowerEscrow = await getBorrowerEscrow(borrowerAddress, appId)

  const params = await algodClient.getTransactionParams().do()
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const ownerTokenId = (await getLocalStateValue({
    address: invoice.address(),
    appId: minterId,
    key: 'asa_id',
  })) as number
  if (!amount) {
    amount = (await getLocalStateValue({
      address: invoice.address(),
      appId: minterId,
      key: 'value',
    })) as number
    amount = (amount * getConfigNumber('USDC_DECIMAL_SCALE')) / getConfigNumber('USD_CENTS_SCALE')
  }
  const tokens = await getAppTokenIds(appId)

  // Borrower calls repay function in matching app
  params.flatFee = true
  params.fee = getConfigNumber('REPAY_FEE')
  const repayTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: borrowerEscrow.address(),
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('repay'))],
    foreignAssets: [ownerTokenId, tokens.currencyId],
    foreignApps: [minterId],
    accounts: [invoice.address(), investorEscrow.address()],
  })

  // Transfer invoice value from borrower to investor escrow
  params.fee = 0
  const currencyTxn = await createTransferAssetTxn({
    fromAddress: borrowerEscrow.address(),
    toAddress: investorEscrow.address(),
    assetId: tokens.currencyId,
    amount,
    params,
  })

  // Transfer ownership token from investor escrow to invoice
  params.fee = 0
  const ownAssetTxn = await createTransferAssetTxn({
    fromAddress: investorEscrow.address(),
    toAddress: invoice.address(),
    assetId: ownerTokenId,
    amount: 1,
    closeRemainderTo: invoice.address(),
    params,
  })

  algosdk.assignGroupID([repayTxn, currencyTxn, ownAssetTxn])
  const signedRepayTxn = algosdk.signLogicSigTransaction(repayTxn, borrowerEscrow)
  const signedCurrencyTxn = algosdk.signLogicSigTransaction(currencyTxn, borrowerEscrow)
  const signedOwnAssetTxn = algosdk.signLogicSigTransaction(ownAssetTxn, investorEscrow)
  const tx = await algodClient
    .sendRawTransaction([signedRepayTxn.blob, signedCurrencyTxn.blob, signedOwnAssetTxn.blob])
    .do()
  await waitForTransaction(tx.txId)

  return signedRepayTxn.txID
}
