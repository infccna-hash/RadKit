// Report templates by modality (French). The radiologist edits freely after inserting.
export const templates = {
  CT: {
    label: 'Scanner (TDM)',
    technique: 'Acquisition hélicoïdale sans puis avec injection de produit de contraste iodé. Reconstructions multiplanaires.',
    findings: '- Parenchyme :\n- Structures vasculaires :\n- Ganglions :\n- Os et parties molles :',
    conclusion: '',
  },
  MR: {
    label: 'IRM',
    technique: 'Séquences T1, T2, FLAIR, diffusion et T1 après injection de gadolinium.',
    findings: '- Signal :\n- Prise de contraste :\n- Diffusion :\n- Structures adjacentes :',
    conclusion: '',
  },
  CR: {
    label: 'Radiographie',
    technique: 'Clichés de face et de profil.',
    findings: '- Structures osseuses :\n- Interlignes articulaires :\n- Parties molles :',
    conclusion: '',
  },
  DX: { ref: 'CR' },
  US: {
    label: 'Échographie',
    technique: 'Examen échographique par voie sus-pubienne / abdominale, sonde convexe.',
    findings: '- Foie :\n- Vésicule et voies biliaires :\n- Pancréas :\n- Rate :\n- Reins :\n- Vessie :',
    conclusion: '',
  },
  MG: {
    label: 'Mammographie',
    technique: 'Incidences face et oblique externe bilatérales.',
    findings: '- Densité mammaire (ACR) :\n- Opacités / distorsions :\n- Microcalcifications :\n- Creux axillaires :',
    conclusion: 'Classification BI-RADS : ',
  },
  default: {
    label: 'Générique',
    technique: '',
    findings: '',
    conclusion: '',
  },
};

export function templateFor(modalities = []) {
  for (const m of modalities) {
    const t = templates[m];
    if (t) return t.ref ? templates[t.ref] : t;
  }
  return templates.default;
}
