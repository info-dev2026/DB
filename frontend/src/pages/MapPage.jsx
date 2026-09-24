import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import SiteMap from '../components/SiteMap/SiteMap';

export default function MapPage() {
  const { sites } = useData();
  const navigate = useNavigate();

  const open = (site) => navigate('/sites/' + site.id);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Site Map</div>
          <div className="page-sub">
            <span>{sites.length} connected sites</span>
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="panel-h">
          <h3>Geographic Overview</h3>
          <div className="legend-inline">
            <span>
              <i className="ld" style={{ background: 'var(--st-green)' }}></i>Compliant
            </span>
            <span>
              <i className="ld" style={{ background: 'var(--st-yellow)' }}></i>Warning
            </span>
            <span>
              <i className="ld" style={{ background: 'var(--st-red)' }}></i>Exceedance
            </span>
            <span>
              <i className="ld" style={{ background: 'var(--st-grey)' }}></i>Offline
            </span>
          </div>
        </div>
        <SiteMap sites={sites} onSelect={open} height={620} />
      </div>
    </>
  );
}