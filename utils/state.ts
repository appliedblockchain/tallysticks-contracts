import { algodClient } from './init'

export function decodeState(stateArray: Record<string, any>): Record<string, any> {
  const state = {}

  for (let i = 0; i < stateArray.length; i++) {
    const key = Buffer.from(stateArray[i]['key'], 'base64').toString('utf8')

    let value = stateArray[i]['value']
    const valueType = value['type']

    if (valueType === 2) {
      // value is uint64
      value = value.uint
    } else if (valueType === 1) {
      // value is byte array
      value = new Uint8Array(Buffer.from(value.bytes, 'base64'))
    } else {
      throw Error(`Unexpected state type: ${valueType}`)
    }

    state[key] = value
  }

  return state
}

export async function getAppGlobalState(appID: number): Promise<Record<string, any>> {
  const appInfo = await algodClient.getApplicationByID(appID).do()
  return decodeState(appInfo['params']['global-state'])
}

export function getValueFromKeyValue(kv: Record<string, any>, decode = true): number | string | Buffer {
  return {
    [1]: decode ? Buffer.from(kv.value.bytes, 'base64').toString() : Buffer.from(kv.value.bytes, 'base64'),
    [2]: kv.value.uint,
  }[kv.value.type]
}

export interface GetGlobalStateValueParams {
  appId: number
  key: string
  decodeValue?: boolean
}

export async function getGlobalStateValue({
  appId,
  key,
  decodeValue = true,
}: GetGlobalStateValueParams): Promise<number | string | Buffer> {
  const app = await algodClient.getApplicationByID(appId).do()
  const globalState = app.params['global-state']
  const encodedKey = Buffer.from(key).toString('base64')
  const keyValue = globalState.find((kv) => kv.key === encodedKey)
  if (keyValue) {
    return getValueFromKeyValue(keyValue, decodeValue)
  }
  throw new Error(`Key ${key} not found`)
}

export async function hasGlobalStateValue(appId: number, key: string): Promise<boolean> {
  const app = await algodClient.getApplicationByID(appId).do()
  const globalState = app.params['global-state']
  const encodedKey = Buffer.from(key).toString('base64')
  const keyValue = globalState.find((kv) => kv.key === encodedKey)
  return !!keyValue
}

export interface GetLocalStateValueParams {
  address: string
  appId: number
  key: string
  decodeKey?: boolean
  decodeValue?: boolean
}

export async function getLocalStateValue({
  address,
  appId,
  key,
  decodeKey = true,
  decodeValue = true,
}: GetLocalStateValueParams): Promise<number | string | Buffer> {
  const accountInfo = await algodClient.accountInformation(address).do()
  const localState = accountInfo[`apps-local-state`]
  if (!localState) {
    throw new Error('No local state')
  }
  const appLocalState = localState.find((app) => app.id === appId)
  if (!appLocalState) {
    throw new Error('No local state')
  }
  const keyValuePairs = appLocalState['key-value']
  for (let i = 0; i < keyValuePairs.length; i++) {
    let localKey = keyValuePairs[i].key
    if (decodeKey) {
      localKey = Buffer.from(keyValuePairs[i].key, 'base64').toString()
    }
    if (key === localKey) {
      return getValueFromKeyValue(keyValuePairs[i], decodeValue)
    }
  }
  throw new Error(`Key ${key} not found`)
}

export async function getBalances(account: string): Promise<Record<number, number>> {
  const balances = {}

  const accountInfo = await algodClient.accountInformation(account).do()

  // set key 0 to Algo balance
  balances[0] = accountInfo['amount']

  const assets = accountInfo['assets']
  for (let i = 0; i < assets.length; i++) {
    const assetID = assets[i]['asset-id']
    const amount = assets[i]['amount']
    balances[assetID] = amount
  }

  return balances
}

export async function getLastBlockTimestamp(): Promise<{ block: Record<string, any>; timestamp: number }> {
  const status = await algodClient.status().do()
  const lastRound = status['last-round']
  const block = await algodClient.block(lastRound).do()
  const timestamp = block['block']['ts']

  return { block, timestamp }
}
