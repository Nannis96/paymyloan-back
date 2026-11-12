// Vencimiento del mes `base + monthOffset` en el día `paymentDueDay`; si el mes
// no tiene ese día (29/30/31), cae en el último día de ese mes.
export function dueDateAt(base: Date, paymentDueDay: number, monthOffset: number): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + monthOffset;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(paymentDueDay, lastDay)));
}

// `firstPaymentDate` debe caer en `paymentDueDay` (o en el último día de su mes).
export function isFirstPaymentOnDueDay(firstPaymentDate: Date, paymentDueDay: number): boolean {
  return dueDateAt(firstPaymentDate, paymentDueDay, 0).getTime() === firstPaymentDate.getTime();
}
