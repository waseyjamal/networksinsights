// Fixture: a global that is real, but not on the list of APIs all three runtimes share.
export function compile(bytes: BufferSource): Promise<WebAssembly.Module> {
  return WebAssembly.compile(bytes);
}
