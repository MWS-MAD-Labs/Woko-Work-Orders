import type { FacilityAsset } from './FacilitiesView';
import type { Locale } from './i18n';

export function assetCategory(asset: FacilityAsset) { return asset.category || 'Uncategorized'; }
export function matchesAsset(asset: FacilityAsset, search: string, category: string) {
  return (!category || assetCategory(asset) === category) && `${asset.name} ${asset.asset_code} ${assetCategory(asset)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}
export function FacilityAssetFilters({ assets, locale, search, category, onSearch, onCategory }: { assets: FacilityAsset[]; locale: Locale; search: string; category: string; onSearch: (value: string) => void; onCategory: (value: string) => void }) {
  const isId = locale === 'id';
  return <div className="facility-asset-filters"><input type="search" aria-label={isId ? 'Cari item' : 'Search items'} placeholder={isId ? 'Cari nama, kode, atau kategori…' : 'Search name, code, or category…'} value={search} onChange={(event) => onSearch(event.target.value)} /><select aria-label={isId ? 'Filter kategori' : 'Filter category'} value={category} onChange={(event) => onCategory(event.target.value)}><option value="">{isId ? 'Semua kategori' : 'All categories'}</option>{[...new Set(assets.map(assetCategory))].sort().map((value) => <option key={value} value={value}>{value}</option>)}</select></div>;
}
