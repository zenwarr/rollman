export function isEmptyOrArrayOfStrings(input: unknown): input is undefined | string[] {
  if (input == null) {
    return true;
  }

  return Array.isArray(input) && !input.some(elem => typeof elem !== "string");
}
