const assert = require('node:assert/strict')
const test = require('node:test')
const { MAX_DAYS, totalFor } = require('../models/bannerOrderModel')

test('the banner price grows with the number of days', () => {
  assert.equal(totalFor(1, '5000.00'), '5000.00')
  assert.equal(totalFor(7, '5000.00'), '35000.00')
  assert.equal(totalFor(30, '1999.99'), '59999.70')
  assert.ok(Number(totalFor(14, '5000')) > Number(totalFor(7, '5000')))
})

test('the day count must be a whole number within the allowed range', () => {
  assert.throws(() => totalFor(0, '5000'), { statusCode: 400 })
  assert.throws(() => totalFor(MAX_DAYS + 1, '5000'), { statusCode: 400 })
  assert.throws(() => totalFor(2.5, '5000'), { statusCode: 400 })
  assert.throws(() => totalFor(7, 'abc'), { statusCode: 400 })
})
