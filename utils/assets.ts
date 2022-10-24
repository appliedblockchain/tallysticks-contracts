import { algodClient } from './init'

interface AssetParams {
  creatorAddress?: string
  name?: string
  unitName?: string
}

export async function getAssetsInWallet(address: string, assetParams: AssetParams): Promise<any[]> {
  const assets = []
  const accountInfo = await algodClient.accountInformation(address).do()
  const allAssets = accountInfo.assets
  if (!allAssets) {
    return assets
  }
  for (let i = 0; i < allAssets.length; i++) {
    const assetInfo = await algodClient.getAssetByID(allAssets[i]['asset-id']).do()
    if (assetParams.creatorAddress && assetInfo.params.creator !== assetParams.creatorAddress) {
      continue
    }
    if (assetParams.name && assetInfo.params.name !== assetParams.name) {
      continue
    }
    if (assetParams.unitName && assetInfo.params['unit-name'] !== assetParams.unitName) {
      continue
    }
    assets.push(allAssets[i])
  }
  return assets
}
