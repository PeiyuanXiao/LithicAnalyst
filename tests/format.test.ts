import { describe, expect, it } from 'vitest';
import { DIGITS, fmtCount, fmtNum, fmtQuantity, MISSING, quantityUnit } from '../src/core/format';

describe('number formatting', () => {
  it('writes fixed decimals without thousands separators', () => {
    expect(fmtNum(1.23456, 3)).toBe('1.235');
    expect(fmtNum(40, 3)).toBe('40.000');
    expect(fmtNum(1234567.891, 2)).toBe('1234567.89');
    expect(fmtNum(-2.5, 1)).toBe('-2.5');
    expect(fmtNum(12.4, 0)).toBe('12');
  });

  it('drops the sign of a negative zero', () => {
    expect(fmtNum(-0.0001, 3)).toBe('0.000');
    expect(fmtNum(-0, 2)).toBe('0.00');
    expect(fmtNum(-0.4, 0)).toBe('0');
  });

  it('shows missing values as an em dash', () => {
    expect(MISSING).toBe('—');
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(fmtNum(v, 3)).toBe('—');
      expect(fmtCount(v)).toBe('—');
      expect(fmtQuantity('length', v)).toBe('—');
    }
  });

  it('gives each kind of quantity its own decimals', () => {
    expect(DIGITS).toEqual({ length: 3, coord: 3, area: 2, volume: 2, angle: 1, ratio: 3 });
    expect(fmtQuantity('length', 20)).toBe('20.000');
    expect(fmtQuantity('coord', -1.23456)).toBe('-1.235');
    expect(fmtQuantity('area', 2800)).toBe('2800.00');
    expect(fmtQuantity('volume', 8000)).toBe('8000.00');
    expect(fmtQuantity('angle', 37.24)).toBe('37.2');
    expect(fmtQuantity('ratio', 0.92857)).toBe('0.929');
  });

  it('writes counts with thousands separators', () => {
    expect(fmtCount(0)).toBe('0');
    expect(fmtCount(999)).toBe('999');
    expect(fmtCount(1000)).toBe('1,000');
    expect(fmtCount(1234567)).toBe('1,234,567');
    expect(fmtCount(-1234)).toBe('-1,234');
    expect(fmtCount(2_000_000.4)).toBe('2,000,000');
    // the same as the status bar has always written them
    expect(fmtCount(1234567)).toBe((1234567).toLocaleString('en-US'));
  });

  it('names the unit of each quantity', () => {
    expect(quantityUnit('length', 'mm')).toBe('mm');
    expect(quantityUnit('coord', 'in')).toBe('in');
    expect(quantityUnit('area', 'mm')).toBe('mm²');
    expect(quantityUnit('volume', 'cm')).toBe('cm³');
    expect(quantityUnit('angle', 'mm')).toBe('°');
    expect(quantityUnit('angle', '')).toBe('°');
    expect(quantityUnit('ratio', 'mm')).toBe('');
    // no stated unit, none shown
    expect(quantityUnit('length', '')).toBe('');
    expect(quantityUnit('area', '')).toBe('');
  });
});
