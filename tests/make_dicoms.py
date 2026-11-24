"""Generate small synthetic DICOM studies for the test-suite (no real patient data)."""
import sys, os
import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid, CTImageStorage, UltrasoundImageStorage

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

def make(name, pid, dob, sex, modality, desc, inst, n=2, burned=None):
    study_uid, series_uid = generate_uid(), generate_uid()
    folder = os.path.join(out, f"{pid}_{modality}_{study_uid[-6:]}")
    os.makedirs(folder, exist_ok=True)
    for i in range(n):
        sop = CTImageStorage if modality == 'CT' else UltrasoundImageStorage
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = sop
        meta.MediaStorageSOPInstanceUID = generate_uid()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = Dataset()
        ds.file_meta = meta
        ds.SOPClassUID = sop
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.PatientName = name
        ds.PatientID = pid
        ds.PatientBirthDate = dob
        ds.PatientSex = sex
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.StudyDate = '20261110'
        ds.StudyDescription = desc
        ds.InstitutionName = inst
        ds.Modality = modality
        ds.SeriesNumber = 1
        ds.InstanceNumber = i + 1
        ds.Rows = ds.Columns = 8
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = 'MONOCHROME2'
        ds.BitsAllocated = ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        if burned:
            ds.BurnedInAnnotation = burned
        ds.PixelData = (np.arange(64, dtype=np.uint16) * (i + 1)).tobytes()
        path = os.path.join(folder, f"img{i}.dcm")
        try:
            ds.save_as(path, enforce_file_format=True)      # pydicom >= 3
        except TypeError:
            ds.save_as(path, write_like_original=False)     # pydicom 2.x
    return folder

make('BENALI^MOHAMED', 'P123', '19800101', 'M', 'CT', 'TDM THORACIQUE', 'CHU BATNA')
make('BENALI^MOHAMED', 'P123', '19800101', 'M', 'CT', 'TDM ABDOMINALE', 'CHU BATNA')       # same ID → attach
make('BEN ALI^MOHAMMED', 'X9988', '19800101', 'M', 'CT', 'TDM CEREBRALE', 'CLINIQUE EL AMEL')  # → suggestion
make('SAADI^FATIMA', 'F55', '19920314', 'F', 'US', 'ECHO ABDOMINALE', 'CABINET SAADI', burned='YES')
print("ok")
