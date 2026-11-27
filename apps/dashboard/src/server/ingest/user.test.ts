import { describe, expect, it } from 'vitest';
import { userColumns } from './user';

describe('userColumns', () => {
  it('uses the phone and segment the app sent', () => {
    expect(userColumns({ id: 'u-1', phone: '231770000001', segment: 'merchant' })).toEqual({
      userPhone: '231770000001',
      userSegment: 'merchant',
    });
  });

  it('derives the segment from a "segment:" id prefix, lowercased', () => {
    expect(userColumns({ id: 'KYC:231770000001' })).toEqual({
      userPhone: null,
      userSegment: 'kyc',
    });
    expect(userColumns({ id: 'ftth:0886' }).userSegment).toBe('ftth');
  });

  it('leaves ids without a usable prefix unsegmented', () => {
    for (const id of ['user-42', 'kyc:', ':42', '12:34', `${'a'.repeat(40)}:x`]) {
      expect(userColumns({ id }).userSegment).toBeNull();
    }
  });

  it('is empty without a user, and ignores blank optional fields', () => {
    expect(userColumns(undefined)).toEqual({ userPhone: null, userSegment: null });
    expect(userColumns({ id: 'x', phone: ' ', segment: ' ' })).toEqual({
      userPhone: null,
      userSegment: null,
    });
  });
});
