export type StockBitacoraItem = {
  quantity_delta: number;
  delta_label: string;
  occurred_at_lima: string;
};

export type StockBitacoraResponse = {
  product_id: string;
  school_id: string;
  items: StockBitacoraItem[];
  has_more: boolean;
  limit: number;
  offset: number;
};

export type StockBitacoraTarget = {
  productId: string;
  schoolId: string;
  productName: string;
  schoolName: string;
};
