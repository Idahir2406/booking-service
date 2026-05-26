export const textToNumberFormatter = (text: string): number => {
  const numericText = text.replaceAll(/\D/g, "");

  return Number(numericText);
};
