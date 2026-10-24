import { db } from '@appdeploy/sdk';

export async function testPrivateDatabase(userId: string) {
  const table = 'integration_probe:' + userId;
  const nonce = 'probe-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  let id: string | null = null;
  let passed = false;
  let cleanedUp = false;
  try {
    const [created] = await db.add(table, [{ nonce, value: 'initial' }]);
    if (!created) throw Error('Create failed');
    id = created;
    const [read] = await db.get<{ nonce: string; value: string }>(table, [id]);
    if (read?.nonce !== nonce || read.value !== 'initial') throw Error('Readback failed');
    const [updated] = await db.update(table, [{ id, record: { nonce, value: 'updated' } }]);
    if (!updated) throw Error('Update failed');
    const [again] = await db.get<{ nonce: string; value: string }>(table, [id]);
    if (again?.value !== 'updated') throw Error('Updated readback failed');
    passed = true;
  } finally {
    if (id) {
      const [deleted] = await db.delete(table, [id]);
      cleanedUp = Boolean(deleted);
    }
  }
  return { passed: passed && cleanedUp, createdReadUpdated: passed, cleanedUp, testedAt: new Date().toISOString(), realWagersTouched: false };
}
