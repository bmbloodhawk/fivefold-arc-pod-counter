export async function accountDeckRoute({ req, url, parts, readBody, account, accountHistory }) {
  if (req.method === 'POST' && url.pathname === '/api/account/decks') {
    const accountId = await account(req);
    return { status: 201, data: { deck: await accountHistory.createDeck(accountId, await readBody()) } };
  }
  if (req.method === 'GET' && url.pathname === '/api/account/decks') {
    const accountId = await account(req);
    return { status: 200, data: { decks: await accountHistory.decks(accountId, {
      includeArchived: url.searchParams.get('archived') === 'all',
    }) } };
  }
  if (req.method === 'PATCH' && parts[0] === 'api' && parts[1] === 'account' && parts[2] === 'decks' && parts[3]) {
    const accountId = await account(req);
    return { status: 200, data: { deck: await accountHistory.updateDeck(accountId, parts[3], await readBody()) } };
  }
  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'account' && parts[2] === 'decks' && parts[3]) {
    const accountId = await account(req);
    await accountHistory.removeDeck(accountId, parts[3]);
    return { status: 204, data: {} };
  }
  return null;
}
