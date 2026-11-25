const assert = require('node:assert/strict')
const test = require('node:test')
const { isValidName } = require('../utils/verificationStorage')

test('only generated document names are accepted', () => {
  assert.equal(isValidName('3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b.pdf'), true)
  assert.equal(isValidName('3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b.png'), true)
  assert.equal(isValidName('../../etc/passwd'), false)
  assert.equal(isValidName('3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b.exe'), false)
  assert.equal(isValidName(null), false)
})
