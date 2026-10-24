"""Production gateway smoke tests against the built Node/Python application."""
import http.cookiejar,json,os,socket,subprocess,tempfile,time,unittest,urllib.request,urllib.error
from pathlib import Path

class HostedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not Path('dist/server.mjs').exists():raise unittest.SkipTest('Build the Node server first: npm run build')
        cls.temp=tempfile.TemporaryDirectory()
        def port():
            with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
        cls.port=port();cls.internal=port();cls.base='http://127.0.0.1:'+str(cls.port)
        cls.env=dict(os.environ,PORT=str(cls.port),HOST='127.0.0.1',FUSION_INTERNAL_PORT=str(cls.internal),WORKSPACE_USER='owner',WORKSPACE_PASSWORD='fixture-password-123456',EDGEBOARD_DB=cls.temp.name+'/edgeboard.db',EDGEFUSION_DB=cls.temp.name+'/fusion.db')
        cls.log=open(cls.temp.name+'/server.log','w+')
        cls.process=subprocess.Popen(['node','dist/server.mjs'],env=cls.env,stdout=cls.log,stderr=cls.log)
        for _ in range(100):
            try:
                if urllib.request.urlopen(cls.base+'/health',timeout=1).status==200:break
            except (OSError,urllib.error.URLError):pass
            if cls.process.poll() is not None:
                cls.log.seek(0);raise RuntimeError(cls.log.read())
            time.sleep(.1)
        else:raise RuntimeError('Gateway did not become healthy')
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:cls.process.kill();cls.process.wait()
        cls.log.close();cls.temp.cleanup()
    def client(self):
        jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        body=b'username=owner&password=fixture-password-123456'
        client.open(urllib.request.Request(self.base+'/login',data=body)).read()
        return client,jar
    def test_auth_boundary_and_health(self):
        for path in ['/api/state','/edgeboard-api/research-policy','/session']:
            with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(self.base+path)
            self.assertEqual(e.exception.code,401)
        req=urllib.request.Request(self.base+'/health',headers={'Host':'evil.example'})
        with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(req)
        self.assertEqual(e.exception.code,403)
    def test_login_storage_models_converter_and_origin(self):
        client,jar=self.client()
        self.assertEqual(len(list(jar)),1)
        def get(path):return json.load(client.open(self.base+path))
        def post(path,body,origin=None):
            headers={'Content-Type':'application/json'}
            if origin:headers['Origin']=origin
            return json.load(client.open(urllib.request.Request(self.base+path,data=json.dumps(body).encode(),headers=headers)))
        self.assertEqual(get('/session')['user']['userId'],'owner')
        self.assertEqual(get('/tools/odds?american=-110')['source'],'alexbet-sharp-bot')
        self.assertTrue(post('/edgeboard-api/test-ledger-storage',{})['passed'])
        self.assertIn('wagers',get('/edgeboard-api/wager-ledger'))
        self.assertEqual(get('/edgeboard-api/corrected-receiving-readiness')['status'],'HOLD')
        self.assertTrue(get('/edgeboard-api/corrected-receiving-readiness')['artifactVerified'])
        self.assertIn('parlayPolicy',get('/edgeboard-api/research-policy')['policy'])
        self.assertIn('markets',get('/api/state'))
        with self.assertRaises(urllib.error.HTTPError) as e:post('/api/wagers',{},'https://evil.example')
        self.assertEqual(e.exception.code,403)
        client.open(urllib.request.Request(self.base+'/logout',data=b'')).read()
        with self.assertRaises(urllib.error.HTTPError) as e:client.open(self.base+'/api/state')
        self.assertEqual(e.exception.code,401)
    def test_public_host_refuses_missing_password(self):
        result=subprocess.run(['node','dist/server.mjs'],env=dict(self.env,HOST='0.0.0.0',WORKSPACE_PASSWORD=''),capture_output=True,text=True,timeout=10)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('at least 16 characters',result.stderr)

if __name__=='__main__':unittest.main()
