# three.js (vendorado)

Build ESM do [three.js](https://threejs.org) servido localmente para o robô 3D
da landing (`/js/features-robot-3d.js`), eliminando dependência de CDN externo.

- **Versão:** r184 (`three@0.184.0`)
- **Origem:** pacote npm oficial (`npm pack three@0.184.0`), pasta `build/`
- **Arquivos:**
  - `three.module.min.js` — entrypoint ESM (importa `./three.core.min.js`)
  - `three.core.min.js` — core
  - `LICENSE` — MIT

Nenhum dos dois faz requisição a URL externa em runtime.

## Como atualizar

```bash
npm pack three@<versão>
tar -xzf three-<versão>.tgz
cp package/build/three.module.min.js package/build/three.core.min.js package/LICENSE \
   whatshybrid-backend/public/assets/three/
```

Depois confira a landing no navegador (o robô 3D usa só o core: geometrias
primitivas, `MeshStandardMaterial`, luzes e `WebGLRenderer`).
