import fs from 'fs/promises'
import path from 'path'
import algosdk from 'algosdk'

// Main function
;(async () => {
  const account = algosdk.generateAccount()
  const pk = algosdk.decodeAddress(account.addr)
  const mn = algosdk.secretKeyToMnemonic(account.sk)

  const output = {
    ...account,
    pk,
    mn,
  }

  // Write the result to a log file
  const outputDir = path.join(__dirname, `./logs`)
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `./account_${account.addr}.json`)
  await fs.writeFile(outputPath, JSON.stringify(output))

  console.log(`Writing to: ${outputPath}`)
  console.log(output)
})()
