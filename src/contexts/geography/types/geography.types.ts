export interface Paginated<T> {
  items: T[];
  has_more: boolean;
}

export interface ProvinceOption {
  id: number;
  label: string;
}

export interface TownOption {
  id: number;
  label: string;
  name: string;
  alias: string;
  lat: number | null;
  lng: number | null;
}

export interface ProvinceRecord {
  id: number;
  provincia: string;
  label: string;
}

export interface TownRecord extends TownOption {
  id_provincia: number;
}
