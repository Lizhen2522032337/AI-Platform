import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('stores a salted scrypt hash and verifies only the correct password', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(encoded).toMatch(/^scrypt\$131072\$8\$1\$/);
    await expect(
      verifyPassword('correct horse battery staple', encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword('wrong password', encoded)).resolves.toBe(false);
  });
});
