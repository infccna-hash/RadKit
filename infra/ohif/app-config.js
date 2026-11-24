/** OHIF v3 configuration for RadKit.
 *  The viewer is served on :8081 and reads DICOMweb from the same origin,
 *  so the RadKit session / share cookie is sent and checked by nginx. */

/* WebGL guard — vtk.js (OHIF's render engine) does
 *   return new Proxy(canvas.getContext('webgl'), handler)
 * without checking for null, so a browser with no WebGL dies with
 * "TypeError: Cannot create proxy with a non-object as target or handler".
 * RadKit answers that by switching to the server-rendered preview
 * (/simple-viewer: JPEG from Orthanc, no canvas, no WebGL). */
(function () {
  try {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) return;
    if (/[?&]nofallback=1/.test(location.search)) return; // escape hatch: see OHIF's own error
    location.replace('/simple-viewer' + location.search);
  } catch (e) {}
})();

/* Expired / missing session — the DICOMweb gate answers 401 with an empty body,
 * which OHIF shows as "One or more of the requested studies are not available".
 * Catch the 401 and offer the login instead of the dead end. */
(function () {
  if (typeof window.fetch !== 'function') return;
  var orig = window.fetch;
  var shown = false;
  var overlay = function () {
    if (shown) return;
    shown = true;
    var app = location.protocol + '//' + location.hostname + (location.port === '8081' ? '' : ':' + location.port);
    var box = document.createElement('div');
    box.setAttribute('style', 'font:16px/1.6 system-ui,Segoe UI,Arial;padding:48px;max-width:640px;margin:0 auto;color:#111');
    box.innerHTML =
      '<h2 style="margin:0 0 12px">Session expirée</h2>' +
      '<p>Votre session a expiré ou ce lien ne vous donne pas accès à cet examen.</p>' +
      '<p><a href="' + app + '/" style="display:inline-block;padding:10px 18px;background:#0b6bcb;color:#fff;border-radius:6px;text-decoration:none">Se reconnecter</a></p>' +
      '<p style="color:#666;font-size:14px">Après la connexion, rouvrez l\'examen depuis la liste de travail.</p>';
    if (document.body) { document.body.innerHTML = ''; document.body.appendChild(box); }
    document.title = 'Session expirée — RadKit';
  };
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    return orig.apply(this, arguments).then(function (res) {
      if (res && res.status === 401 && /\/dicom-web\//.test(url)) overlay();
      return res;
    });
  };
  /* cornerstone-wado-image-loader speaks XMLHttpRequest, not fetch */
  if (window.XMLHttpRequest) {
    var xo = XMLHttpRequest.prototype.open;
    var xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__rkUrl = u;
      return xo.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      this.addEventListener('load', function () {
        if (self.status === 401 && /\/dicom-web\//.test(self.__rkUrl || '')) overlay();
      });
      return xs.apply(this, arguments);
    };
  }
})();

window.config = {
  routerBasename: '/',
  showStudyList: false,
  extensions: [],
  modes: [],
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  strictZSpacingForVolumeViewport: true,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: 'radkit',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'radkit',
      configuration: {
        friendlyName: 'RadKit',
        name: 'radkit',
        wadoUriRoot: '/dicom-web',
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
        omitQuotationForMultipartRequest: true,
        bulkDataURI: { enabled: true },
        requestOptions: { requestCredentials: 'include' },
      },
    },
  ],
};
