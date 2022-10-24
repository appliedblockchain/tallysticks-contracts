import { Account, LogicSigAccount } from 'algosdk'
import { getAssetLogicSigAccount } from '@appliedblockchain/silentdata-mint'
import { optAssetLogicSigAccountIntoApplication } from '@appliedblockchain/silentdata-mint'

export async function createInvoice(invoiceId: Uint8Array, appId: number): Promise<LogicSigAccount> {
  return await getAssetLogicSigAccount(invoiceId, appId)
}

export async function optInvoiceIntoMatchingApplication(
  sender: Account | LogicSigAccount,
  mintAppId: number,
  appId: number,
  invoice: LogicSigAccount,
): Promise<void> {
  await optAssetLogicSigAccountIntoApplication(invoice, mintAppId, appId, sender)
}
