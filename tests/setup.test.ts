import algosdk from 'algosdk'
import { getGenesisAccounts } from './setup'

describe('setup', () => {
  describe('getGenesisAccounts', () => {
    it('Should create valid genesis accounts', async () => {
      const accounts = await getGenesisAccounts()
      expect(accounts.length).toEqual(3)
      accounts.forEach((account) => {
        expect(algosdk.isValidAddress(account.addr)).toBeTruthy()
        expect(account.sk.byteLength).toEqual(64)
      })
    })
  })
})
