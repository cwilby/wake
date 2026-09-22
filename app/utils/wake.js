import wol from 'wake_on_lan';

export default (...opts) => new Promise((resolve, reject) => {
    wol.wake(...opts, (err) => {
        if (err) return reject(err);
        resolve();
    }); 
});