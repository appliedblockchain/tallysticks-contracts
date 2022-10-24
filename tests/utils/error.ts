export const getContractErrorMessage = (e: any): string | undefined => {
  return e?.response?.body?.message
}

export const isContractException = (e: any): boolean => {
  const errMsg = getContractErrorMessage(e)
  return errMsg !== undefined
}

export const isContractLogicException = (e: any): boolean => {
  const errMsg = getContractErrorMessage(e)
  return errMsg !== undefined && errMsg.includes('rejected by logic')
}

export const isContractLogicEvalException = (e: any): boolean => {
  const errMsg = getContractErrorMessage(e)
  return errMsg !== undefined && errMsg.includes('logic eval error')
}
