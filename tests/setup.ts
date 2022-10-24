import { Account } from 'algosdk'
import { kmdClient } from '../utils/init'

const kmdAccounts = []

export async function getGenesisAccounts(): Promise<Account[]> {
  if (kmdAccounts.length === 0) {
    const { wallets } = await kmdClient.listWallets()
    if (wallets.length === 0) {
      throw new Error('No wallets')
    }
    const walletID = wallets[0].id

    const { wallet_handle_token: walletHandle } = await kmdClient.initWalletHandle(walletID, '')

    try {
      const { addresses } = await kmdClient.listKeys(walletHandle)
      for (let i = 0; i < addresses.length; i++) {
        const privateKey = await kmdClient.exportKey(walletHandle, '', addresses[i])
        kmdAccounts.push({ sk: privateKey.private_key, addr: addresses[i] })
      }
    } finally {
      await kmdClient.releaseWalletHandle(walletHandle)
    }
  }

  return kmdAccounts
}
