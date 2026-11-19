import { describe, it, expect } from 'vitest';
import { townFromAddress, UNKNOWN_TOWN } from './address-town';
import { formatAddress } from './google';

// Made-up addresses throughout.
describe('townFromAddress', () => {
  it('takes the town, not the postcode, from what formatAddress builds', () => {
    const address = formatAddress({ addressLines: ['1 Test Street', 'Unit 2'], locality: 'Testtown', postalCode: 'ZZ1 1ZZ' });
    expect(address).toBe('1 Test Street, Unit 2, Testtown, ZZ1 1ZZ');
    expect(townFromAddress(address)).toBe('Testtown');
  });

  it('prefers a structured locality when the caller has one', () => {
    expect(townFromAddress('1 Test Street, Testtown, ZZ1 1ZZ', 'Otherville')).toBe('Otherville');
    expect(townFromAddress(null, '  Otherville ')).toBe('Otherville');
  });

  it('ignores an empty locality and reads the address instead', () => {
    expect(townFromAddress('1 Test Street, Testtown, ZZ1 1ZZ', '')).toBe('Testtown');
    expect(townFromAddress('1 Test Street, Testtown, ZZ1 1ZZ', '   ')).toBe('Testtown');
    expect(townFromAddress('1 Test Street, Testtown, ZZ1 1ZZ', null)).toBe('Testtown');
  });

  it.each([
    ['postcode without a space', '9 Sample Road, Mapleford, AB12CD', 'Mapleford'],
    ['a London-style postcode', '3 Example Lane, Westbury, SW1A 1AA', 'Westbury'],
    ['an outward code only', '3 Example Lane, Westbury, M1', 'Westbury'],
    ['a postcode stuck to the town', '3 Example Lane, Westbury M1 1AA', 'Westbury'],
    ['a country on the end', '3 Example Lane, Westbury, AB1 2CD, United Kingdom', 'Westbury'],
    ['no postcode at all', '3 Example Lane, Westbury', 'Westbury'],
    ['a two-word town', '12 Fake Row, Little Sampleton, ZZ9 9ZZ', 'Little Sampleton'],
    ['extra spaces and empty parts', ' 3 Example Lane ,, Westbury ,  AB1 2CD ', 'Westbury'],
  ])('handles %s', (_label, address, town) => {
    expect(townFromAddress(address)).toBe(town);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['just a postcode', 'ZZ1 1ZZ'],
    ['a street line and a postcode, no town', '1 Test Street, ZZ1 1ZZ'],
    ['only a street line', '1 Test Street'],
  ])('falls back to "your area" for %s', (_label, address) => {
    expect(townFromAddress(address as any)).toBe(UNKNOWN_TOWN);
    expect(UNKNOWN_TOWN).toBe('your area');
  });
});
