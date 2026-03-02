playwright.config.ts:
{
  "testFramework": "Jest"
}

tests/hello-world.spec.ts:
test('hello world', () => {
  expect(1 + 1).toBe(2);
});