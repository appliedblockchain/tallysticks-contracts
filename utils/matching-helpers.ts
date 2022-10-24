import algosdk, { getApplicationAddress } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { algodClient } from './init'
import { getGlobalStateValue, getLocalStateValue, hasGlobalStateValue } from './state'
import { getAssetsInWallet } from './assets'

export async function isAppSetUp(appId: number): Promise<boolean> {
  const appAddress = await algosdk.getApplicationAddress(appId)
  const appInfo = await algodClient.accountInformation(appAddress).do()
  const appTokens = appInfo['created-assets']
  return appTokens.length !== 0
}

export async function getAppTokenIds(appId: number): Promise<Record<string, number>> {
  const appAddress = algosdk.getApplicationAddress(appId)

  let bidId, accessId
  const appInfo = await algodClient.accountInformation(appAddress).do()
  const appTokens = appInfo['created-assets']
  if (appTokens.length === 0) {
    throw new Error('App not set up')
  }

  for (let i = 0; i < appTokens.length; i++) {
    const tokenName = appTokens[i].params.name
    if (tokenName === 'TallysticksBid') {
      bidId = appTokens[i].index
    } else if (tokenName === 'TallysticksAccess') {
      accessId = appTokens[i].index
    }
  }

  const currencyId = (await getGlobalStateValue({ appId, key: 'currency_id' })) as number

  return { currencyId, bidId, accessId }
}

export async function getAppTokenState(address: string): Promise<Record<string, number>> {
  const info = await algodClient.accountInformation(address).do()
  if (info.assets.length === 0) {
    throw new Error('No tokens in account')
  }
  let usdc, bid, access
  for (let i = 0; i < info.assets.length; i++) {
    const assetInfo = await algodClient.getAssetByID(info.assets[i]['asset-id']).do()
    if (!assetInfo) {
      continue
    }
    const total = info.assets[i].amount
    if (assetInfo.params['unit-name'] === 'USDC') {
      usdc = total
    } else if (assetInfo.params['unit-name'] === 'TLBID') {
      bid = total
    } else if (assetInfo.params['unit-name'] === 'TLACS') {
      access = total
    }
  }
  const algo = info.amount
  return { usdc, bid, access, algo }
}

export async function hasAccessToken(address: string, appId: number): Promise<boolean> {
  const appAddress = getApplicationAddress(appId)
  const assets = await getAssetsInWallet(address, { creatorAddress: appAddress, name: 'TallysticksAccess' })
  return assets.length === 1 && assets[0].amount === 1
}

export async function calculateInvoicePrice(
  appId: number,
  invoiceAddress: string,
  currentTimestamp?: number,
): Promise<number> {
  // price = value / ((1 + interest[/year] * tenor[s] / (s in year)))
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number

  let value = BigInt((await getLocalStateValue({ address: invoiceAddress, appId: minterId, key: 'value' })) as number)
  value = (value * BigInt(getConfigNumber('USDC_DECIMAL_SCALE'))) / BigInt(getConfigNumber('USD_CENTS_SCALE'))
  value = value * BigInt(getConfigNumber('INTEREST_SCALE'))

  const interest = BigInt(
    (await getLocalStateValue({ address: invoiceAddress, appId: minterId, key: 'interest_rate' })) as number,
  )

  const dueDate = (await getLocalStateValue({ address: invoiceAddress, appId: minterId, key: 'due_date' })) as number
  const bidTimeout = currentTimestamp || ((await getGlobalStateValue({ appId, key: 'bidding_timeout' })) as number)
  const tenor = BigInt(dueDate - bidTimeout)
  return Number(
    value /
      (BigInt(getConfigNumber('INTEREST_SCALE')) + (interest * tenor) / BigInt(getConfigNumber('SECONDS_IN_YEAR'))),
  )
}

export async function areAllBidsCollected(appId: number) {
  const appAddress = algosdk.getApplicationAddress(appId)
  const appTokens = await getAppTokenState(appAddress)
  const tokenReserveSize = (await getGlobalStateValue({
    appId,
    key: 'token_reserve_size',
  })) as number
  return appTokens.bid === tokenReserveSize
}

export async function isAppLocked(appId: number) {
  return await hasGlobalStateValue(appId, 'bidding_timeout')
}

export async function isWinnerFound(appId: number) {
  const winnerFound = await hasGlobalStateValue(appId, 'escrow_address')
  const allBidsCollected = await areAllBidsCollected(appId)
  return winnerFound && allBidsCollected
}

export async function isAppReset(appId: number) {
  return !(await hasGlobalStateValue(appId, 'owner_address'))
}
