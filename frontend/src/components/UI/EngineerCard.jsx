import { useData } from '../../context/DataContext';

export default function EngineerCard() {
  const { creds } = useData();
  const nm = creds?.engName || 'Chandan';
  const mob = creds?.engMobile || '93191 99574';
  const initial = (nm.replace(/^(Sh\.|Mr\.|Ms\.|Dr\.|Er\.)\s*/i, '').trim()[0] || 'C').toUpperCase();

  return (
    <div className="eng-card">
      <div className="eng-av">{initial}</div>
      <div className="eng-info">
        <b>Senior Engineer</b>
        <div className="er">{nm} · Saaphzone Technologies</div>
        <div className="em">☎ {mob}</div>
      </div>
    </div>
  );
}
