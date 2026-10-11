import { diffDays, parseDay } from '../../utils/dates';

export interface PricedItem {
  qty: number;
  dailyPriceMinor: number;
  depositMinor: number;
}

/** All money is integer minor units (paise/cents). Never floats. */
export function computePricing(items: PricedItem[], days: number) {
  const rentMinor = items.reduce((sum, i) => sum + i.qty * i.dailyPriceMinor * days, 0);
  const depositMinor = items.reduce((sum, i) => sum + i.qty * i.depositMinor, 0);
  return { rentMinor, depositMinor, totalMinor: rentMinor + depositMinor };
}

export const LATE_FEE_MULTIPLIER_PERCENT = 150; // late days cost 1.5x the daily rent

export function computeSettlement(input: {
  rentMinor: number;
  depositMinor: number;
  days: number;
  rentalEnd: string;
  returnedOn: Date; // UTC day the item was picked up
  damageMinor: number;
}) {
  const lateDays = Math.max(0, diffDays(parseDay(input.rentalEnd), input.returnedOn));
  const dailyRent = input.rentMinor / input.days;
  const lateFeeMinor = Math.round((lateDays * dailyRent * LATE_FEE_MULTIPLIER_PERCENT) / 100);
  const authorized = input.rentMinor + input.depositMinor;
  // Never capture more than was authorized: the deposit is the cap on damage + late fees.
  const capturedMinor = Math.min(authorized, input.rentMinor + lateFeeMinor + input.damageMinor);
  return { lateDays, lateFeeMinor, damageMinor: input.damageMinor, capturedMinor };
}
