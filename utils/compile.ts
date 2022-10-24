import { algodClient } from './init'
import algosdk from 'algosdk'
import path from 'path'
import fs from 'fs'

export type CompiledApp = {
  program: Uint8Array
  programHash: Uint8Array
}

export async function compile(name: string, folder: string, templateVariables = {}): Promise<any> {
  try {
    const filePath = path.join(__dirname, '..', 'teal', folder, name)
    let contents = fs.readFileSync(filePath, { encoding: 'ascii' })

    Object.keys(templateVariables).forEach((variableName) => {
      const replacer = new RegExp(`<${variableName}>`, 'g')
      contents = contents.replace(replacer, templateVariables[variableName])
    })

    const data = Buffer.from(contents)
    const results = await algodClient.compile(data).do()
    const compiledOutputFile = (filePath.split('.teal')[0] += '--compiled.teal')
    fs.writeFileSync(compiledOutputFile, data)

    results.compiledOutputFile = compiledOutputFile
    return results
  } catch (error) {
    console.log(error)
  }
}

export async function fullyCompileContractFromFile(fileName: string): Promise<CompiledApp> {
  try {
    const filePath = path.join(__dirname, '..', 'teal', fileName)
    const data = fs.readFileSync(filePath)
    const response = await algodClient.compile(data).do()
    return {
      program: new Uint8Array(Buffer.from(response.result, 'base64')),
      // ATTN response.hash is a SHA512_256 of program bytes encoded in the address style
      programHash: algosdk.decodeAddress(response.hash).publicKey,
    }
  } catch (error) {
    console.log(error)
  }
}
