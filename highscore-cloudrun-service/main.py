import json, datetime
import functions_framework
from google.cloud import storage


storage_client = storage.Client()
bucket_name = "asteroids-highscores"
object_name = "highscores.json"
headers = [("Access-Control-Allow-Origin", "*")]


@functions_framework.http
def main(request):
    if request.path == "/":
        return list_highscores()
    elif request.path == "/submit" and request.method == "POST":
        return submit(request)
    else:
        return "Bad request", 400, headers


def list_highscores():
    data = read_storage()
    return data, 200, headers


def submit(request):
    try:
        name = request.args["name"]
        if len(name) == 0 or len(name) > 20:  raise

        score = round(float(request.args["score"]), 1)
        if score <= 0 or score > 100000:  raise
    except:
        return "Bad request", 400, headers

    data = read_storage()
    data = json.loads(data)

    # Insert into list, new entry first on equal scores
    data.insert(0, {"name": name, "score": score, "timestamp": datetime.datetime.now().isoformat()})
    data = sorted(data, key=lambda x: -x["score"])[:10]
    write_storage(data)

    return data, 200, headers


def read_storage():
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    return blob.download_as_text()


def write_storage(data):
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    data = json.dumps(data)
    blob.upload_from_string(data)
