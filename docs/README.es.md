# dagdo for Orca

[English](../README.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | Español

**Visualiza los bloqueos y encuentra la siguiente tarea que puedes empezar.**
El navegador y la CLI comparten datos locales. No necesitas cuenta, clave API ni
servicio en la nube. Funciona en Windows, macOS y Linux; Orca es opcional.
La interfaz y la salida de comandos están en inglés. Los títulos y notas admiten Unicode.

## Funciones

- Dependencias visuales sin ciclos y tareas disponibles mediante `next`.
- Proyectos, Backlog, notas, vistas de árbol y mapa mental, tema claro y oscuro.
- Actualizaciones en directo y salida JSON para scripts y agentes.
- Deshacer/rehacer compartido, bloqueo de escrituras y las últimas 30 copias de seguridad.
- Integración opcional para crear espacios Git independientes con Orca.

## Descarga e instalación

Instala **Bun 1.4.4 o posterior** siguiendo las [instrucciones oficiales](https://bun.sh/docs/installation).
Con Git, ejecuta estos comandos en PowerShell, Bash o Zsh:

```sh
git clone https://github.com/OsamuMikumo0704/dagdo-for-orca.git dagdo/app
cd dagdo/app
bun install --frozen-lockfile
bun run build
bun run start
```

También puedes [descargar el ZIP del código](https://github.com/OsamuMikumo0704/dagdo-for-orca/archive/refs/heads/main.zip),
extraerlo en una carpeta exclusiva `dagdo/app` y ejecutar los últimos tres comandos.
El ZIP funciona sin metadatos Git. Este fork no ofrece instaladores de escritorio,
publicación npm ni fórmula Homebrew.

El inicio crea una copia de seguridad y abre **http://localhost:3737**. Mantén
abierta la terminal. Detén el servidor con **Ctrl+C** o **Shut down** en la interfaz.
Usa `bun run start --no-open` para no abrir el navegador o
`bun run start --port 3837` para elegir otro puerto. Windows también permite
ejecución en segundo plano mediante `scripts/start.ps1` y `scripts/stop.ps1`.

## Primera dependencia

```sh
bun run scripts/dagdo.ts add 'Diseñar la base de datos' --json
bun run scripts/dagdo.ts add 'Implementar la API' --after <design-id> --json
bun run scripts/dagdo.ts next --json
bun run scripts/dagdo.ts done <design-id> --json
```

Sustituye `<design-id>` por el ID del primer comando. Al completar el diseño,
se desbloquea la implementación. Con varios proyectos, consulta `projects --json`
y añade `--project <ID>` a los comandos de tareas. En el navegador, haz doble clic
para editar, arrastra entre conectores para crear dependencias y mueve una tarea
del Backlog al mapa para pasarla a Ready.

## Datos y mantenimiento

Con el código en `dagdo/app`, los datos privados quedan en `dagdo/data` y las copias
en `dagdo/backups`. Usa una carpeta padre exclusiva por instalación: las que comparten
carpeta padre comparten datos. Los worktrees Git adicionales usan `.dagdo-dev/`
con datos ficticios. Configura `DAGDO_DATA_DIR` y `DAGDO_BACKUP_DIR` solo para el
proceso correspondiente, nunca globalmente.

```sh
bun run backup
# Detén la interfaz y todos los agentes que escriban datos antes de restaurar:
bun run restore /absolute/path/to/dagdo/backups/GENERATION --writes-stopped
```

No edites `data.json` directamente. Los datos y las copias son JSON sin cifrar;
no publiques tareas privadas, registros, claves ni archivos `.env`.
Para actualizar, detén los procesos, crea una copia y ejecuta `git pull --ff-only`,
`bun install --frozen-lockfile` y `bun run check`; después reinicia. Con un ZIP,
sustituye solo el código tras hacer la copia. Es una aplicación local de un solo
usuario: no expongas el servidor a Internet.

## Ayuda y contribuciones

- [Referencia completa de comandos](../README.md#use-the-cli) o `bun run scripts/dagdo.ts help`
- [Operaciones y resolución de problemas](operations.md)
- [Errores y propuestas](https://github.com/OsamuMikumo0704/dagdo-for-orca/issues/new/choose)
- [Contribuir y traducir](../CONTRIBUTING.md) · [Informes privados de seguridad](../SECURITY.md)

Licencia MIT, con [copyright original](../LICENSE) y [atribuciones](../THIRD_PARTY_NOTICES.md).
