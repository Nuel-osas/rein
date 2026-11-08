import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeTxError, describeError, errorFromCode, errorFromLogs, isProgramRefusal } from '../src/errors.ts';
import { IDL_ERRORS } from '../src/idl.ts';

test('maps every Rein error code to its IDL name', () => {
  assert.ok(IDL_ERRORS.length >= 17);
  for (const e of IDL_ERRORS) {
    const d = errorFromCode(e.code);
    assert.equal(d.name, e.name);
    assert.equal(d.source, 'program');
  }
  assert.equal(errorFromCode(6000).name, 'TeamPaused');
  assert.equal(errorFromCode(6004).name, 'WrongPayee');
  assert.equal(errorFromCode(6013).name, 'BadServiceId');
});

test('maps Anchor framework codes', () => {
  const d = errorFromCode(3012);
  assert.equal(d.name, 'AccountNotInitialized');
  assert.equal(d.source, 'anchor');
  assert.match(d.message, /already initialized/);
  assert.equal(errorFromCode(2006).name, 'ConstraintSeeds');
  assert.equal(errorFromCode(3007).name, 'AccountOwnedByWrongProgram');
  assert.ok(isProgramRefusal(d));
});

test('unknown codes stay visible', () => {
  const d = errorFromCode(424242);
  assert.equal(d.name, 'Custom424242');
  assert.equal(d.source, 'runtime');
  assert.equal(isProgramRefusal(d), false);
});

test('reads the account Anchor blamed from the logs', () => {
  const logs = [
    'Program F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe invoke [1]',
    'Program log: Instruction: Pay',
    'Program log: AnchorError caused by account: service. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.',
    'Program F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe failed: custom program error: 0xbc4',
  ];
  const d = errorFromLogs(logs)!;
  assert.equal(d.name, 'AccountNotInitialized');
  assert.equal(d.code, 3012);
  assert.equal(d.account, 'service');
  assert.equal(describeError(d), 'AccountNotInitialized (3012) on account service: The program expected this account to be already initialized');
});

test('reads program errors thrown in the handler', () => {
  const d = errorFromLogs([
    'Program log: AnchorError thrown in programs/rein/src/lib.rs:203. Error Code: ServiceSuspended. Error Number: 6003. Error Message: the service is suspended.',
  ])!;
  assert.equal(d.name, 'ServiceSuspended');
  assert.equal(d.source, 'program');
  assert.equal(d.account, undefined);
});

test('falls back to the hex code in the logs', () => {
  assert.equal(errorFromLogs(['Program X failed: custom program error: 0x177a'])!.name, 'ZeroAmount');
});

test('decodes signature-status errors without logs', () => {
  assert.equal(decodeTxError({ InstructionError: [0, { Custom: 6012 }] }).name, 'BadIntent');
  assert.equal(decodeTxError({ InstructionError: [0, { Custom: 3012 }] }).name, 'AccountNotInitialized');
  const runtime = decodeTxError({ InstructionError: [0, 'InvalidAccountData'] });
  assert.equal(runtime.name, 'InvalidAccountData');
  assert.equal(runtime.source, 'runtime');
  assert.equal(decodeTxError('BlockhashNotFound').name, 'BlockhashNotFound');
  assert.equal(decodeTxError({ InsufficientFundsForRent: { account_index: 0 } }).name, 'InsufficientFundsForRent');
  assert.equal(decodeTxError(new Error('Simulation failed: custom program error: 0x1773')).name, 'ServiceSuspended');
});
