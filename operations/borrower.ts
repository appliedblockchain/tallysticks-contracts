import algosdk, { Account, LogicSigAccount } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { waitForTransaction } from '../utils/transactions'
import { algodClient } from '../utils/init'
import { createTransferAssetTxn } from '../utils/transactions'
import { getGlobalStateValue, getLocalStateValue } from '../utils/state'
import { getAppTokenIds } from '../utils/matching-helpers'
import { optInvoiceIntoMatchingApplication } from '../utils/mint'

export async function verify(borrower: Account, appId: number, invoice: LogicSigAccount): Promise<void> {
  // Invoice opts in to matching app
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const params = await algodClient.getTransactionParams().do()
  try {
    await optInvoiceIntoMatchingApplication(borrower, minterId, appId, invoice)
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
    from: borrower.addr,
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
    fromAddress: borrower.addr,
    toAddress: appAddress,
    assetId: ownerTokenId,
    amount: 1,
    params: tfrParams,
  })

  algosdk.assignGroupID([verifyTxn, ownAssetTxn])
  const signedVerifyTxn = verifyTxn.signTxn(borrower.sk)
  const signedOwnAssetTxn = ownAssetTxn.signTxn(borrower.sk)
  const tx = await algodClient.sendRawTransaction([signedVerifyTxn, signedOwnAssetTxn]).do()
  await waitForTransaction(tx.txId)
}

export interface RepayParams {
  borrower: Account
  appId: number
  invoice: LogicSigAccount
  escrow: LogicSigAccount
  amount?: number
}

export async function repay({ borrower, appId, invoice, escrow, amount }: RepayParams): Promise<void> {
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
    from: borrower.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('repay'))],
    foreignAssets: [ownerTokenId, tokens.currencyId],
    foreignApps: [minterId],
    accounts: [invoice.address(), escrow.address()],
  })

  // Transfer invoice value from borrower to investor escrow
  params.fee = 0
  const currencyTxn = await createTransferAssetTxn({
    fromAddress: borrower.addr,
    toAddress: escrow.address(),
    assetId: tokens.currencyId,
    amount,
    params,
  })

  // Transfer ownership token from investor escrow to invoice
  params.fee = 0
  const ownAssetTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: invoice.address(),
    assetId: ownerTokenId,
    amount: 1,
    closeRemainderTo: invoice.address(),
    params,
  })

  algosdk.assignGroupID([repayTxn, currencyTxn, ownAssetTxn])
  const signedRepayTxn = repayTxn.signTxn(borrower.sk)
  const signedCurrencyTxn = currencyTxn.signTxn(borrower.sk)
  const signedOwnAssetTxn = algosdk.signLogicSigTransaction(ownAssetTxn, escrow)
  const tx = await algodClient.sendRawTransaction([signedRepayTxn, signedCurrencyTxn, signedOwnAssetTxn.blob]).do()
  await waitForTransaction(tx.txId)
}
