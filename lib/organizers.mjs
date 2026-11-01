/** 投稿ランキング専用：運営メンバーの表示制御。元データや他の集計は変更しない。 */
import { userKey } from './analytics.mjs';

export const ORGANIZER_NAMES = Object.freeze(['芋太郎', 'キュア時雨', '星野ぼび', 'はん']);
const organizerKeys = new Set(ORGANIZER_NAMES.map(userKey));

/** 名前そのもの、または名前＋Xの@ID表記だけを照合する（部分一致による誤除外を避ける）。 */
export function isOrganizerName(value) {
  const original = String(value ?? '').normalize('NFKC').trim();
  // Name (@handle) / Name @handle の表記を許容。X IDしかない場合は統合ルールで名前に寄せる。
  const withoutHandle = original
    .replace(/\s*\(\s*@[A-Za-z0-9_]+\s*\)$/u, '')
    .replace(/\s+@[A-Za-z0-9_]+$/u, '')
    .trim();
  return organizerKeys.has(userKey(withoutHandle));
}

/** 除外後に順位を1位から振り直す。表示・CSV・期間比較で共通利用する。 */
export function visibleUserRanking(groups, showOrganizers = false) {
  return (showOrganizers ? groups : groups.filter(g => !isOrganizerName(g.label)))
    .map((g, i) => ({...g, rank:i + 1}));
}
