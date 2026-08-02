export function unwrapTransformationContract(value) {
  if (value?.kind) return value;
  if (value?.contract?.kind) return value.contract;
  return value;
}
