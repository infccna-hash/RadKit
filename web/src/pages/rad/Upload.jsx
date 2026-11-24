import { useOutletContext } from 'react-router-dom';
import { PageHeader } from '../../components/ui.jsx';
import UploadPanel from '../../components/UploadPanel.jsx';

export default function RadUpload() {
  const { refreshStats } = useOutletContext();
  return (
    <>
      <PageHeader
        title="Importer des examens"
        subtitle="Les patients sont créés automatiquement à partir des métadonnées DICOM. Vous validez ensuite ceux à garder."
      />
      <UploadPanel onDone={refreshStats} studyLink={(id) => `/app/studies/${id}`} />
    </>
  );
}
