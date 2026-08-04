export type ScrapedProduct = {
  supermarket: string;
  externalId: string;
  name: string;
  brand?: string;
  category?: string;
  url: string;
  imageUrl?: string;
  regularPrice?: number;
  offerPrice: number;
  unit?: string;
  unitPrice?: number;
  stock?: boolean;
};
