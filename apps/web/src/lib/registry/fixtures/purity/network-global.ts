// Fixture: tool logic that goes to the network.
export async function load(url: string): Promise<string> {
  const response = await fetch(url);
  return response.text();
}
