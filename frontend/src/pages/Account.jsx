import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import Panel from '../components/UI/Panel';
import EngineerCard from '../components/UI/EngineerCard';

export default function Account() {
  const { session } = useAuth();
  const { sites, changePassword } = useData();

  const site = sites.find((s) => s.id === session?.siteId);

  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confPass, setConfPass] = useState('');

  if (!site) return <div className="empty">No site linked to this login.</div>;

  const updatePasscode = async () => {
    if (newPass.length < 4) {
      toast.error('New passcode must be at least 4 characters.');
      return;
    }
    if (newPass !== confPass) {
      toast.error('New passcode entries do not match.');
      return;
    }
    try {
      await changePassword({
        target: 'industry',
        current: curPass,
        new: newPass,
      });
      toast.success('Passcode updated.');
      setCurPass('');
      setNewPass('');
      setConfPass('');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const openSupport = () =>
    window.dispatchEvent(new CustomEvent('open-support'));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Account</div>
          <div className="page-sub">
            <span>{site.name}</span>
            <span>·</span>
            <span className="mono">{site.id}</span>
          </div>
        </div>
      </div>

      <Panel title="Site Details">
        <div className="form-grid">
          <div className="fg">
            <label>Industry</label>
            <input value={site.name} disabled />
          </div>
          <div className="fg">
            <label>Industry code</label>
            <input value={site.id} disabled />
          </div>
          <div className="fg">
            <label>Contact person</label>
            <input value={site.contact || '—'} disabled />
          </div>
          <div className="fg">
            <label>Alert mobile</label>
            <input value={site.phone || '—'} disabled />
          </div>
        </div>
      </Panel>

      <Panel
        title="Change Passcode"
        hint="Used to sign in to your account"
        right={
          <button className="btn btn-primary btn-sm" onClick={updatePasscode}>
            Update passcode
          </button>
        }
      >
        <div className="form-grid">
          <div className="fg">
            <label>Current passcode</label>
            <input
              type="password"
              value={curPass}
              onChange={(e) => setCurPass(e.target.value)}
              placeholder="default 1234"
            />
          </div>
          <div className="fg"></div>
          <div className="fg">
            <label>New passcode</label>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="min 4 characters"
            />
          </div>
          <div className="fg">
            <label>Confirm new passcode</label>
            <input
              type="password"
              value={confPass}
              onChange={(e) => setConfPass(e.target.value)}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Your service engineer">
        <EngineerCard />
        <button
          className="btn btn-primary"
          style={{ marginTop: 14 }}
          onClick={openSupport}
        >
          ⚠ Raise Complaint
        </button>
      </Panel>
    </>
  );
}