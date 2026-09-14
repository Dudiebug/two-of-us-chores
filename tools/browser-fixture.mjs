import { openDatabase } from '../src/db.mjs';
import { createApp } from '../src/server.mjs';
const db = await openDatabase(':memory:', { D: 'dylan-test-password', M: 'mady-test-password' });
const app = await createApp({db, env:{APP_ORIGIN:'http://localhost:3099',ALLOW_INSECURE_LOCALHOST:'true'}, push:{configured:false, send:async()=>false}});
app.server.listen(3099, '127.0.0.1',()=>console.log('ready'));
