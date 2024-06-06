import { DomUtil, DomEvent } from '../../vendors/leaflet/leaflet-src.esm.js'
import { translate } from './i18n.js'
import { uMapAlert as Alert } from '../components/alerts/alert.js'
import Dialog from './ui/dialog.js'
import { SCHEMA } from './schema.js'

const TEMPLATE = `
    <h3><i class="icon icon-16 icon-upload"></i><span>${translate('Add data')}</span></h3>
    <fieldset class="formbox">
      <legend class="counter">${translate('Choose data')}</legend>
      <input type="file" multiple autofocus onchange />
      <input type="url" placeholder="${translate('Provide an URL here')}" onchange />
      <textarea onchange placeholder="${translate('Paste your data here')}"></textarea>
      <div class="importers">
        <h5>${translate('Import helpers:')}</h5>
        <div class="button-bar by4" id="importers">
        </div>
      </div>
    </fieldset>
    <fieldset class="formbox">
      <legend class="counter" data-help="importFormats">${translate('Choose the data format')}</legend>
      <select name="format" onchange></select>
    </fieldset>
    <fieldset class="destination formbox">
      <legend class="counter">${translate('Choose the layer to import in')}</legend>
      <select name="layer-id"></select>
      <label>
        <input type="checkbox" name="clear" />
        ${translate('Replace layer content')}
      </label>
    </fieldset>
    <fieldset class="import-mode formbox">
      <legend class="counter" data-help="importMode">${translate('Choose import mode')}</legend>
      <label>
        <input type="radio" name="action" value="copy" />
        ${translate('Copy into the layer')}
      </label>
      <label>
        <input type="radio" name="action" value="link" />
        ${translate('Link to the layer as remote data')}
      </label>
    </fieldset>
    <input type="button" class="button" name="submit" value="${translate('Add data')}" />
    `

export default class Importer {
  constructor(map) {
    this.map = map
    this.TYPES = ['geojson', 'csv', 'gpx', 'kml', 'osm', 'georss', 'umap']
    this.IMPORTERS = []
    this.loadImporters()
    this.dialog = new Dialog(this.map._controlContainer)
  }

  loadImporters() {
    for (const key of Object.keys(this.map.options.importers || {})) {
      import(`./importers/${key}.js`).then((mod) => {
        this.IMPORTERS.push(new mod.Importer(this.map, this.map.options.importers[key]))
      })
    }
  }

  qs(query) {
    return this.container.querySelector(query)
  }

  get url() {
    return this.qs('[type=url]').value
  }

  set url(value) {
    this.qs('[type=url]').value = value
    this.onChange()
  }

  get format() {
    return this.qs('[name=format]').value
  }

  set format(value) {
    this.qs('[name=format]').value = value
    this.onChange()
  }

  get files() {
    return this.qs('[type=file]').files
  }

  get raw() {
    return this.qs('textarea').value
  }

  get clear() {
    return Boolean(this.qs('[name=clear]').checked)
  }

  get action() {
    return this.qs('[name=action]:checked').value
  }

  get layer() {
    const layerId = this.qs('[name=layer-id]').value
    return this.map.datalayers[layerId] || this.map.createDataLayer()
  }

  build() {
    this.container = DomUtil.create('div', 'umap-upload')
    this.container.innerHTML = TEMPLATE
    if (this.IMPORTERS.length) {
      for (const plugin of this.IMPORTERS) {
        L.DomUtil.createButton(
          'flat',
          this.container.querySelector('#importers'),
          plugin.name,
          () => plugin.open(this)
        )
      }
      this.qs('.importers').toggleAttribute('hidden', false)
    }
    for (const type of this.TYPES) {
      DomUtil.element({
        tagName: 'option',
        parent: this.qs('[name=format]'),
        value: type,
        textContent: type,
      })
    }
    this.map.help.parse(this.container)
    DomEvent.on(this.qs('[name=submit]'), 'click', this.submit, this)
    DomEvent.on(this.qs('[type=file]'), 'change', this.onFileChange, this)
    for (const element of this.container.querySelectorAll('[onchange]')) {
      DomEvent.on(element, 'change', this.onChange, this)
    }
  }

  onChange() {
    this.qs('.destination').toggleAttribute('hidden', this.format === 'umap')
    this.qs('.import-mode').toggleAttribute(
      'hidden',
      this.format === 'umap' || !this.url
    )
  }

  onFileChange(e) {
    let type = '',
      newType
    for (const file of e.target.files) {
      newType = U.Utils.detectFileType(file)
      if (!type && newType) type = newType
      if (type && newType !== type) {
        type = ''
        break
      }
    }
    this.format = type
  }

  onLoad() {
    this.qs('[type=file]').value = null
    this.url = null
    this.format = undefined
    const layerSelect = this.qs('[name="layer-id"]')
    layerSelect.innerHTML = ''
    this.map.eachDataLayerReverse((datalayer) => {
      if (datalayer.isLoaded() && !datalayer.isRemoteLayer()) {
        DomUtil.element({
          tagName: 'option',
          parent: layerSelect,
          textContent: datalayer.options.name,
          value: L.stamp(datalayer),
        })
      }
    })
    DomUtil.element({
      tagName: 'option',
      value: '',
      textContent: translate('Import in a new layer'),
      parent: layerSelect,
    })
  }

  open() {
    if (!this.container) this.build()
    const onLoad = this.map.editPanel.open({ content: this.container })
    onLoad.then(() => this.onLoad())
  }

  openFiles() {
    this.open()
    this.fileInput.showPicker()
  }

  submit() {
    if (this.format === 'umap') this.full()
    else if (!this.url) this.copy()
    else if (this.action) this[this.action]()
  }

  full() {
    this.map.once('postsync', this.map._setDefaultCenter)
    try {
      if (this.files.length) {
        for (const file of this.files) {
          this.map.processFileToImport(file, null, 'umap')
        }
      } else if (this.raw) {
        this.map.importRaw(this.raw)
      } else if (this.url) {
        this.map.importFromUrl(this.url, this.format)
      }
    } catch (e) {
      this.map.alert.open({ content: translate('Invalid umap data'), level: 'error' })
      console.error(e)
    }
  }

  link() {
    if (!this.url) return
    if (!this.format) {
      Alert.error(translate('Please choose a format'))
      return
    }
    let layer = this.layer
    layer.options.remoteData = {
      url: this.url,
      format: this.format,
    }
    if (this.map.options.urls.ajax_proxy) {
      layer.options.remoteData.proxy = true
      layer.options.remoteData.ttl = SCHEMA.ttl.default
    }
    layer.fetchRemoteData(true)
  }

  copy() {
    // Format may be guessed from file later.
    // Usefull in case of multiple files with different formats.
    if (!this.format && !this.files.length) {
      Alert.error(translate('Please choose a format'))
      return
    }
    let layer = this.layer
    if (this.clear) layer.empty()
    if (this.files.length) {
      for (const file of this.files) {
        this.map.processFileToImport(file, layer, this.format)
      }
    } else if (this.raw) {
      layer.importRaw(this.raw, this.format)
    } else if (this.url) {
      layer.importFromUrl(this.url, this.format)
    }
  }
}
